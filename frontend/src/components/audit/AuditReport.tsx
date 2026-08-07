import { FlaskConical } from "lucide-react";
import type { BatchAuditReport } from "@/lib/audit";
import { summarizeReport } from "@/lib/auditReportStats";
import { AuditReportSummary } from "./AuditReportSummary";
import { FileResultItem } from "./FileResultItem";

interface AuditReportProps {
  report: BatchAuditReport;
  zipName: string;
  /** True when this report came from the bundled sample ZIP rather than a real upload —
   *  drives the "sample data" banner below so nobody mistakes a demo run for their own
   *  invoices (Phase 4f). */
  isDemo?: boolean;
  onReset: () => void;
}

export function AuditReport({ report, zipName, isDemo = false, onReset }: AuditReportProps) {
  const stats = summarizeReport(report);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="font-mono-data text-[11px] uppercase tracking-[0.22em] text-[var(--azul)]">
          Resultado
        </p>
        <button
          type="button"
          onClick={onReset}
          className="font-mono-data border border-[var(--hairline-strong)] px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink)] transition-colors hover:border-[var(--ink)]"
        >
          Auditar otro lote
        </button>
      </div>

      {isDemo ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-[var(--azul)]/40 bg-[var(--azul)]/5 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <FlaskConical className="size-4 shrink-0 text-[var(--azul)]" strokeWidth={1.5} aria-hidden="true" />
            <p className="font-mono-data text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--azul)]">
              Estás viendo datos de muestra — no es tu información real
            </p>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="font-mono-data shrink-0 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--azul)] underline underline-offset-2 hover:text-[var(--azul-deep)]"
          >
            Sube tu propio ZIP
          </button>
        </div>
      ) : null}

      <div className="mt-5">
        <AuditReportSummary stats={stats} zipName={zipName} />
      </div>

      {report.files.length === 0 ? (
        <div className="corner-box mt-8 bg-[var(--paper-raised)] px-6 py-12 text-center">
          <span className="cb-extra" aria-hidden="true" />
          <p className="font-display text-lg font-bold text-[var(--ink)]">
            No se encontró ningún XML en este ZIP.
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-soft)]">
            Revisa que hayas comprimido los archivos <code className="font-mono-data">.xml</code>{" "}
            del SAT y no otra carpeta.
          </p>
        </div>
      ) : (
        <div className="corner-box mt-8 bg-[var(--paper-raised)] px-1 sm:px-2">
          <span className="cb-extra" aria-hidden="true" />
          {report.files.map((entry, i) => (
            <FileResultItem key={`${entry.fileName}-${i}`} entry={entry} />
          ))}
        </div>
      )}

      {report.skipped.length > 0 ? (
        <details className="mt-6">
          <summary className="font-mono-data cursor-pointer text-[11.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] hover:text-[var(--ink-soft)]">
            {report.skipped.length} {report.skipped.length === 1 ? "archivo omitido" : "archivos omitidos"}{" "}
            (no son .xml)
          </summary>
          <ul className="font-mono-data mt-2 space-y-1 text-[11.5px] leading-relaxed text-[var(--ink-faint)]">
            {report.skipped.map((name) => (
              <li key={name} className="truncate" title={name}>
                {name}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
