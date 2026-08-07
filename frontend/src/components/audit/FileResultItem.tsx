import { useId, useState } from "react";
import { ChevronDown, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileAuditEntry } from "@/lib/audit";
import { classifyFile } from "@/lib/auditReportStats";
import { Tag } from "./Tag";
import { FindingItem } from "./FindingItem";

interface FileResultItemProps {
  entry: FileAuditEntry;
}

function plural(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function FileResultItem({ entry }: FileResultItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();
  const status = classifyFile(entry.result);

  return (
    <div className="border-t border-[var(--hairline-strong)] first:border-t-0">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-1 py-4 text-left sm:px-2"
      >
        <ChevronDown
          className={cn("size-4 shrink-0 text-[var(--ink-faint)] transition-transform", isOpen && "rotate-180")}
          aria-hidden="true"
        />
        <span className="font-mono-data min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--ink)]" title={entry.fileName}>
          {entry.fileName}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {status.kind === "structural-error" ? (
            <Tag tone="rojo">{status.reason === "xsd" ? "XML inválido" : "No se pudo interpretar"}</Tag>
          ) : (
            <>
              {status.errors > 0 ? (
                <Tag tone="rojo">
                  {status.errors} {plural(status.errors, "error", "errores")}
                </Tag>
              ) : null}
              {status.warnings > 0 ? (
                <Tag tone="ambar">
                  {status.warnings} {plural(status.warnings, "advertencia", "advertencias")}
                </Tag>
              ) : null}
              {status.errors === 0 && status.warnings === 0 ? <Tag tone="verde">Sin hallazgos</Tag> : null}
              {status.satUnverified ? (
                <Tag tone="ambar" icon={<ShieldQuestion className="size-3" />}>
                  No verificado SAT
                </Tag>
              ) : (
                <Tag tone="verde" icon={<ShieldCheck className="size-3" />}>
                  Verificado SAT
                </Tag>
              )}
            </>
          )}
        </div>
      </button>

      {isOpen ? (
        <div id={contentId} className="px-1 pb-6 sm:px-2">
          {status.kind === "structural-error" ? (
            <StructuralErrorDetail entry={entry} reason={status.reason} />
          ) : (
            <EvaluatedDetail findings={entry.result.findings} satUnverified={status.satUnverified} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function StructuralErrorDetail({
  entry,
  reason,
}: {
  entry: FileAuditEntry;
  reason: "xsd" | "parse";
}) {
  return (
    <div className="border border-[var(--rojo)]/40 bg-[var(--rojo)]/5 p-4">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--rojo)]" aria-hidden="true" />
        <p className="text-[13.5px] leading-relaxed text-[var(--ink)]">
          {reason === "xsd"
            ? "Este documento no pasó la validación contra el esquema XSD del SAT (CFDI 4.0). Al no ser válido estructuralmente, no se evaluó ninguna regla de negocio sobre él — la corrección tiene que empezar por el XML mismo."
            : "Este documento es válido contra el esquema XSD, pero no pudo interpretarse para evaluar las reglas de negocio."}
        </p>
      </div>
      {reason === "xsd" && entry.result.xsdErrors.length > 0 ? (
        <ul className="font-mono-data mt-3 space-y-1.5 border-t border-[var(--rojo)]/30 pt-3 text-[11.5px] leading-relaxed text-[var(--ink-soft)]">
          {entry.result.xsdErrors.map((err, i) => (
            <li key={i} className="break-words">
              {err}
            </li>
          ))}
        </ul>
      ) : null}
      {reason === "parse" && entry.result.parseError ? (
        <p className="font-mono-data mt-3 border-t border-[var(--rojo)]/30 pt-3 text-[11.5px] leading-relaxed text-[var(--ink-soft)]">
          {entry.result.parseError}
        </p>
      ) : null}
    </div>
  );
}

function EvaluatedDetail({
  findings,
  satUnverified,
}: {
  findings: FileAuditEntry["result"]["findings"];
  satUnverified: boolean;
}) {
  return (
    <div>
      {satUnverified ? (
        <div className="mb-4 flex items-start gap-2.5 border border-[var(--ambar)]/40 bg-[var(--ambar)]/5 p-4">
          <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-[var(--ambar)]" aria-hidden="true" />
          <p className="text-[13.5px] leading-relaxed text-[var(--ink)]">
            No se pudo verificar este CFDI ante el SAT (estado de cancelación y lista 69-B en
            vivo) — ya sea porque la consulta falló o porque el documento no trae UUID.{" "}
            <strong className="font-semibold">
              Esto no significa que el comprobante esté limpio,
            </strong>{" "}
            solo que esas dos verificaciones no se completaron. Revísalo manualmente en el
            portal del SAT.
          </p>
        </div>
      ) : null}

      {findings.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-[var(--ink-faint)]">
          Sin hallazgos en las reglas evaluadas para este documento.
        </p>
      ) : (
        <div>
          {findings.map((finding, i) => (
            <FindingItem key={`${finding.ruleId}-${i}`} finding={finding} />
          ))}
        </div>
      )}
    </div>
  );
}
