// Builds public/demo/muestra-cfdi.zip — the bundled sample data behind the "probar sin
// subir nada" demo path (Phase 4f). Deliberately NOT wired into predev/prebuild like
// sync-static-assets.mjs: the OTHER static assets are mechanical exports of a single
// source of truth (catalogs.db, corpus/xsd/), but this ZIP's content is a hand-curated
// editorial choice (which fixtures, which fictional company names, in what order) — run
// this once, review the output, commit the ZIP directly. Rerun and re-commit only when
// deliberately changing the demo narrative, not as part of every install/build.
//
// Every document here starts from an already fixture-tested, rule-verified XML under
// engine/fixtures/ (see each entry's `source`/`rule` below) — never hand-authored from
// scratch, so every finding this demo produces is exactly the same one already proven
// correct by engine/test/*.test.ts. Only cosmetic fields are substituted: Emisor
// Rfc/Nombre (to avoid all 8 documents looking like the same one company was invoiced 8
// times — every existing fixture reuses the identical "EMPRESA DEMO SINTETICA SA DE CV" /
// ABC010101AB1 for test-isolation reasons that don't matter here) and the Receptor's
// Nombre (kept as ONE consistent fictional client — "COMERCIALIZADORA DEL NORTE SA DE
// CV" — receiving invoices from 8 different suppliers, the realistic accounting-batch
// framing). Nothing that affects rule evaluation (amounts, dates, RegimenFiscal, CP,
// ClaveProdServ/Unidad, Impuestos) is touched — verified by running the real pipeline
// against the output before treating this script as done, not just by inspection.
//
// The one exception, deliberately NOT fictional: entry #8's Emisor Rfc/Nombre are the
// REAL public 69-B record for AAA120730823 (corpus/efos/listado_completo_69b.csv,
// situación "Definitivo") — this is the product's actual differentiator, so the demo
// uses the real dataset it ships with, not an invented RFC that wouldn't trigger
// anything real.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

const FIXTURES = path.resolve(import.meta.dirname, "../../engine/fixtures");
const OUT_DIR = path.resolve(import.meta.dirname, "../public/demo");

const RECEPTOR_OLD = 'Nombre="CLIENTE DE PRUEBA SA DE CV"';
const RECEPTOR_NEW = 'Nombre="COMERCIALIZADORA DEL NORTE SA DE CV"';

const ENTRIES = [
  {
    zipName: "01-distribuidora-ferretera-tepeyac.xml",
    source: "regimen-uso-compat/pass.xml",
    rule: "limpio",
    rfc: "DFT150623LK9",
    nombre: "DISTRIBUIDORA FERRETERA DEL TEPEYAC SA DE CV",
  },
  {
    zipName: "02-materiales-construccion-guadalupe.xml",
    source: "impuestos-totales-consistencia/pass.xml",
    rule: "limpio",
    rfc: "MCG090714QW2",
    nombre: "MATERIALES Y CONSTRUCCION GUADALUPE SA DE CV",
  },
  {
    zipName: "03-transportes-carga-rio.xml",
    source: "claveprodserv-claveunidad-vigente/pass.xml",
    rule: "limpio",
    rfc: "TCR120305RT8",
    nombre: "TRANSPORTES Y CARGA DEL RIO SA DE CV",
  },
  {
    zipName: "04-papeleria-suministros-valle.xml",
    source: "subtotal-descuento-conceptos-suma/fail.xml",
    rule: "subtotal-descuento-conceptos-suma (SubTotal no cuadra con los Conceptos)",
    rfc: "PSV170822ZX4",
    nombre: "PAPELERIA Y SUMINISTROS DEL VALLE SA DE CV",
  },
  {
    zipName: "05-servicios-logisticos-centro.xml",
    source: "impuestos-concepto-rollup-consistencia/fail.xml",
    rule: "impuestos-concepto-rollup-consistencia (IVA del resumen no cuadra con los Conceptos)",
    rfc: "SLC110415NB6",
    nombre: "SERVICIOS LOGISTICOS DEL CENTRO SA DE CV",
  },
  {
    zipName: "06-consultores-quimicos-pacifico.xml",
    source: "domicilio-fiscal-receptor-cp-existe/fail.xml",
    rule: "domicilio-fiscal-receptor-cp-existe (codigo postal del receptor inexistente, warning)",
    rfc: "CQP160910FH3",
    nombre: "CONSULTORES Y QUIMICOS DEL PACIFICO SA DE CV",
  },
  {
    zipName: "07-instalaciones-tecnologia-mayab.xml",
    source: "impuestos-traslados-retenciones-unicidad/fail.xml",
    rule: "impuestos-traslados-retenciones-unicidad (renglon de IVA duplicado)",
    rfc: "ITM140228VD5",
    nombre: "INSTALACIONES Y TECNOLOGIA DEL MAYAB SA DE CV",
  },
  {
    zipName: "08-asesores-administradores-agricolas.xml",
    source: "total-comprobante-consistencia/pass.xml",
    rule: "emisor-efos-69b / emisor-efos-69b-sat (RFC real en la lista 69-B, situacion Definitivo)",
    rfc: "AAA120730823",
    nombre: "ASESORES Y ADMINISTRADORES AGRICOLAS, S. DE R.L. DE C.V.",
  },
];

mkdirSync(OUT_DIR, { recursive: true });

const files = {};
for (const entry of ENTRIES) {
  const srcPath = path.join(FIXTURES, entry.source);
  let xml = readFileSync(srcPath, "utf-8");

  const beforeEmisor = xml;
  xml = xml.replace(
    /Emisor Rfc="[^"]*" Nombre="[^"]*"/,
    `Emisor Rfc="${entry.rfc}" Nombre="${entry.nombre}"`,
  );
  if (xml === beforeEmisor) {
    throw new Error(`${entry.source}: Emisor Rfc/Nombre pattern not found -- fixture format may have changed`);
  }

  const beforeReceptor = xml;
  xml = xml.replace(RECEPTOR_OLD, RECEPTOR_NEW);
  if (xml === beforeReceptor) {
    throw new Error(`${entry.source}: Receptor Nombre "${RECEPTOR_OLD}" not found -- fixture format may have changed`);
  }

  files[entry.zipName] = new TextEncoder().encode(xml);
  console.log(`[build-demo-zip] ${entry.source} -> ${entry.zipName}  (${entry.rule})`);
}

const zipped = zipSync(files, { level: 9 });
const outPath = path.join(OUT_DIR, "muestra-cfdi.zip");
writeFileSync(outPath, zipped);
console.log(`[build-demo-zip] Wrote ${outPath} (${(zipped.length / 1024).toFixed(1)} KB, ${ENTRIES.length} files)`);
