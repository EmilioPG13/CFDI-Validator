import type { Finding } from "@/lib/auditReportStats";
import { Tag } from "./Tag";
import { SatReferenceDisclosure } from "./SatReferenceDisclosure";

interface FindingItemProps {
  finding: Finding;
}

/** Renders `evidence` (typed `unknown` on `Finding` — it's whatever the rule that produced
 *  it captured) as formatted JSON. Never interpreted or reworded, same "presentation only"
 *  boundary as `satReference` — just made scannable instead of dumped as `[object Object]`. */
function formatEvidence(evidence: unknown): string {
  if (typeof evidence === "string") return evidence;
  try {
    return JSON.stringify(evidence, null, 2);
  } catch {
    return String(evidence);
  }
}

export function FindingItem({ finding }: FindingItemProps) {
  return (
    <div className="border-t border-[var(--hairline)] py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={finding.severity === "error" ? "rojo" : "ambar"}>
          {finding.severity === "error" ? "Error" : "Advertencia"}
        </Tag>
        <span className="font-mono-data text-[11px] text-[var(--ink-faint)]">{finding.ruleId}</span>
      </div>

      <p className="font-mono-data mt-2.5 text-[12.5px] leading-relaxed text-[var(--ink-soft)]">
        <span className="text-[var(--ink-faint)]">Campo: </span>
        {finding.fieldPath}
      </p>

      {finding.evidence !== undefined ? (
        <details className="mt-2">
          <summary className="font-mono-data cursor-pointer text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)] hover:text-[var(--ink-soft)]">
            Ver evidencia
          </summary>
          <pre className="font-mono-data mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words border border-[var(--hairline)] bg-[var(--paper)] p-3 text-[11px] leading-relaxed text-[var(--ink-soft)]">
            {formatEvidence(finding.evidence)}
          </pre>
        </details>
      ) : null}

      <SatReferenceDisclosure satReference={finding.satReference} />
    </div>
  );
}
