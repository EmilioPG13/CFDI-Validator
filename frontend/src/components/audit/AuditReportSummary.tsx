import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ReportSummaryStats } from "@/lib/auditReportStats";

const TONE_TEXT: Record<"rojo" | "ambar" | "verde" | "ink", string> = {
  rojo: "text-[var(--rojo)]",
  ambar: "text-[var(--ambar)]",
  verde: "text-[var(--verde)]",
  ink: "text-[var(--ink)]",
};

function StatTile({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  tone?: "rojo" | "ambar" | "verde" | "ink";
}) {
  return (
    <div className="border-[var(--hairline)] bg-[var(--paper-raised)] p-4 sm:p-5">
      <p className={cn("font-display text-[2rem] font-extrabold leading-none tracking-tight", TONE_TEXT[tone])}>
        {value}
      </p>
      <p className="font-mono-data mt-2 text-[10.5px] uppercase leading-snug tracking-[0.1em] text-[var(--ink-faint)]">
        {label}
      </p>
    </div>
  );
}

interface AuditReportSummaryProps {
  stats: ReportSummaryStats;
  zipName: string;
}

/**
 * The "risk report in 60 seconds" moment — every number a contador needs before drilling
 * into a single finding, in one glance. Deliberately a plain stat grid rather than a
 * recharts chart: with 8 independent counts that are each meaningful on their own (not a
 * distribution or a trend), a grid of labeled numbers reads faster than a donut/bar would,
 * and it matches the "technical document" stat-line idiom `sections/Hero.tsx`'s report
 * mockup already established (see its closing "11 hallazgos en 1,197 CFDI…" line).
 */
export function AuditReportSummary({ stats, zipName }: AuditReportSummaryProps) {
  return (
    <div className="corner-box bg-[var(--paper-raised)]">
      <span className="cb-extra" aria-hidden="true" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline-strong)] px-4 py-3 sm:px-5">
        <span className="font-mono-data text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink)]">
          Reporte de riesgo
        </span>
        <span className="font-mono-data truncate text-[10.5px] text-[var(--ink-faint)]" title={zipName}>
          {zipName}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px border border-[var(--hairline)] bg-[var(--hairline)] sm:grid-cols-4">
        <StatTile label="XML auditados" value={stats.filesTotal} />
        <StatTile label="Errores" value={stats.totalErrorFindings} tone={stats.totalErrorFindings > 0 ? "rojo" : "ink"} />
        <StatTile
          label="Advertencias"
          value={stats.totalWarningFindings}
          tone={stats.totalWarningFindings > 0 ? "ambar" : "ink"}
        />
        <StatTile label="Sin hallazgos" value={stats.filesClean} tone="verde" />
        <StatTile label="Verificados ante el SAT" value={stats.filesVerified} tone="verde" />
        <StatTile
          label="No verificados ante el SAT"
          value={stats.filesUnverified}
          tone={stats.filesUnverified > 0 ? "ambar" : "ink"}
        />
        <StatTile
          label="XML inválidos"
          value={stats.filesStructuralError}
          tone={stats.filesStructuralError > 0 ? "rojo" : "ink"}
        />
        <StatTile label="Archivos omitidos (no XML)" value={stats.skippedTotal} />
      </div>
    </div>
  );
}
