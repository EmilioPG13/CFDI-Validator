import { Link } from 'react-router'

function LockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

/** Fila del reporte de ejemplo: UUID corto, estado y fundamento. */
function ReportRow({
  rfc,
  detalle,
  estado,
  fundamento,
  tono,
}: {
  rfc: string
  detalle: string
  estado: string
  fundamento: string
  tono: 'rojo' | 'ambar' | 'verde'
}) {
  const color =
    tono === 'rojo'
      ? 'text-[var(--rojo)] border-[var(--rojo)]'
      : tono === 'ambar'
        ? 'text-[var(--ambar)] border-[var(--ambar)]'
        : 'text-[var(--verde)] border-[var(--verde)]'
  return (
    <div className="border-t border-[var(--hairline)] px-4 py-3 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono-data text-[12.5px] font-semibold text-[var(--ink)]">{rfc}</span>
        <span className="font-mono-data text-[11px] text-[var(--ink-faint)]">{detalle}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={`font-mono-data inline-block border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${color}`}
        >
          {estado}
        </span>
        <span className="font-mono-data text-[10.5px] text-[var(--ink-soft)]">{fundamento}</span>
      </div>
    </div>
  )
}

export default function Hero() {
  return (
    <section id="inicio" className="border-b border-[var(--hairline)]">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-12 lg:gap-10 lg:pb-24 lg:pt-24">
        {/* Columna izquierda: propuesta de valor + diferenciador */}
        <div className="lg:col-span-7">
          <p className="font-mono-data text-[11px] uppercase tracking-[0.22em] text-[var(--azul)]">
            Auditoría de CFDI para contadores en México
          </p>

          <h1 className="font-display mt-6 text-4xl font-extrabold leading-[1.04] tracking-tight text-[var(--ink)] sm:text-5xl lg:text-[3.4rem]">
            Detecta CFDI cancelados y proveedores en la lista 69-B{' '}
            <span className="text-[var(--azul)]">antes de cerrar el mes.</span>
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-[var(--ink-soft)]">
            Audita en lote los XML que ya descargaste del portal del SAT: valida su estado,
            los cruza contra la lista de EFOS y te entrega un reporte de riesgo con el fundamento
            exacto de cada hallazgo. Sin revisar factura por factura a mano.
          </p>

          {/* Diferenciador central: bloque sólido, imposible de pasar por alto */}
          <div className="corner-box mt-9 bg-[var(--azul-deep)] px-6 py-6 text-white sm:px-7">
            <span className="cb-extra" aria-hidden="true" />
            <div className="flex items-center gap-3">
              <LockIcon />
              <p className="font-display text-lg font-bold leading-snug sm:text-xl">
                Nunca te pedimos tu e.firma ni tus contraseñas del SAT.
              </p>
            </div>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-white/85">
              Arrastras el ZIP de XML que ya descargaste tú mismo del portal y todo el análisis
              corre en tu navegador.{' '}
              <strong className="font-semibold text-white">
                Tus archivos no salen de tu computadora.
              </strong>
            </p>
            <p className="font-mono-data mt-4 text-[10.5px] uppercase tracking-[0.16em] text-white/55">
              Sin e.firma · Sin CIEC · Sin contraseñas · Sin envío de XML
            </p>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              to="/auditoria?demo=1"
              className="bg-[var(--azul)] px-6 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--azul-deep)]"
            >
              Probar la demo con datos de ejemplo
            </Link>
            <a
              href="#como-funciona"
              className="border border-[var(--hairline-strong)] px-6 py-3.5 text-[15px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)]"
            >
              Ver cómo funciona
            </a>
          </div>
          <p className="font-mono-data mt-4 text-[10.5px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
            Sin registro · Sin instalar nada · Datos de ejemplo incluidos
          </p>
        </div>

        {/* Columna derecha: reporte de riesgo de ejemplo */}
        <div className="lg:col-span-5">
          <figure className="corner-box bg-[var(--paper-raised)] lg:mt-6">
            <span className="cb-extra" aria-hidden="true" />
            <figcaption className="flex items-center justify-between gap-3 border-b border-[var(--hairline-strong)] px-4 py-3 sm:px-5">
              <span className="font-mono-data text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink)]">
                Reporte de riesgo
              </span>
              <span className="stamp font-mono-data text-[9px] text-[var(--rojo)]">Ejemplo</span>
            </figcaption>

            <div className="font-mono-data flex items-center justify-between border-b border-[var(--hairline)] px-4 py-2.5 text-[10.5px] text-[var(--ink-faint)] sm:px-5">
              <span>Cliente: DESPACHO EJEMPLO, S.C.</span>
              <span>Periodo: 2026-07</span>
            </div>

            <ReportRow
              rfc="PRV840315-XK2"
              detalle="8 CFDI · $412,900.00"
              estado="Proveedor en lista 69-B"
              fundamento="Art. 69-B CFF · EFOS definitivo"
              tono="rojo"
            />
            <ReportRow
              rfc="TME991104-AB3"
              detalle="3 CFDI · $86,250.00"
              estado="Cancelado tras deducirse"
              fundamento="Art. 29-A CFF · cancelación posterior"
              tono="ambar"
            />
            <ReportRow
              rfc="1,186 CFDI restantes"
              detalle="emitidos y vigentes"
              estado="Sin observaciones"
              fundamento="Cruce SAT + lista 69-B"
              tono="verde"
            />

            <div className="border-t border-[var(--hairline-strong)] px-4 py-3 sm:px-5">
              <p className="font-mono-data text-[10.5px] leading-relaxed text-[var(--ink-soft)]">
                11 hallazgos en 1,197 CFDI · análisis local en el navegador · 0 archivos subidos
              </p>
            </div>
          </figure>
          <p className="mt-3 text-right text-[11.5px] italic text-[var(--ink-faint)]">
            Ejemplo ilustrativo con datos ficticios.
          </p>
        </div>
      </div>
    </section>
  )
}
