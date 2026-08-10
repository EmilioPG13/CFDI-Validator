import { useState } from "react";
import { Loader2, ShieldQuestion, Sparkles } from "lucide-react";
import type { Finding } from "@/lib/auditReportStats";
import { explainFinding, type ExplainResult } from "@/lib/explain";
import { Tag } from "./Tag";
import { SatReferenceDisclosure } from "./SatReferenceDisclosure";

interface FindingItemProps {
  finding: Finding;
}

type ExplainUiState = { phase: "idle" } | { phase: "loading" } | { phase: "settled"; result: ExplainResult };

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
  const [explainState, setExplainState] = useState<ExplainUiState>({ phase: "idle" });

  async function handleExplain() {
    setExplainState({ phase: "loading" });
    const result = await explainFinding(finding);
    setExplainState({ phase: "settled", result });
  }

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

      <ExplainBlock state={explainState} onExplain={handleExplain} />
    </div>
  );
}

interface ExplainBlockProps {
  state: ExplainUiState;
  onExplain: () => void;
}

/**
 * The one place a Finding leaves the browser (redacted first — see lib/explain.ts and
 * lib/redact.ts) to get an LLM-written explanation of a rule the deterministic engine
 * already evaluated. The explanation is presentation only, same boundary as
 * SatReferenceDisclosure's own satReference text above it — it never substitutes for the
 * ruleId/satReference already shown, only adds prose interpreting them. A rejected
 * ("unavailable") or timed-out result is rendered explicitly, never as if the button had
 * simply done nothing — same principle FileResultItem's satUnverified banner already
 * applies one level up.
 */
function ExplainBlock({ state, onExplain }: ExplainBlockProps) {
  if (state.phase === "idle") {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={onExplain}
          className="font-mono-data inline-flex items-center gap-1.5 border border-[var(--hairline-strong)] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--azul)] transition-colors hover:border-[var(--azul)]"
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          Explicar con IA
        </button>
      </div>
    );
  }

  if (state.phase === "loading") {
    return (
      <div className="mt-3 flex items-center gap-2 border-l-2 border-[var(--hairline-strong)] pl-3">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--azul)]" aria-hidden="true" />
        <p className="font-mono-data text-[11px] text-[var(--ink-faint)]">
          Generando explicación… puede tardar hasta unos minutos.
        </p>
      </div>
    );
  }

  const { result } = state;

  if (result.status === "done") {
    return (
      <div className="mt-3 border-l-2 border-[var(--azul)] pl-3">
        <p className="font-mono-data text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--azul)]">
          Explicación (generada por IA, verificada contra la cita SAT)
        </p>
        <p className="font-serif-doc mt-1.5 text-[13.5px] leading-relaxed text-[var(--ink)]">
          {result.explanation}
        </p>
        {result.suggestedFix ? (
          <p className="font-serif-doc mt-2 text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
            <span className="font-mono-data text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">
              Sugerencia:{" "}
            </span>
            {result.suggestedFix}
          </p>
        ) : null}
      </div>
    );
  }

  if (result.status === "unavailable") {
    return (
      <div className="mt-3 flex items-start gap-2 border border-[var(--ambar)]/40 bg-[var(--ambar)]/5 p-3">
        <ShieldQuestion className="mt-0.5 size-3.5 shrink-0 text-[var(--ambar)]" aria-hidden="true" />
        <p className="text-[12.5px] leading-relaxed text-[var(--ink-soft)]">{result.reason}</p>
      </div>
    );
  }

  const message = result.status === "timeout" ? "La explicación tardó demasiado en generarse." : result.message;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p className="text-[12.5px] leading-relaxed text-[var(--rojo)]">{message}</p>
      <button
        type="button"
        onClick={onExplain}
        className="font-mono-data text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--azul)] underline underline-offset-2 hover:text-[var(--azul-deep)]"
      >
        Reintentar
      </button>
    </div>
  );
}
