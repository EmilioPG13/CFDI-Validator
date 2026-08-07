import { useId, useState } from "react";
import { ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const PREVIEW_LENGTH = 160;

interface SatReferenceDisclosureProps {
  satReference: string;
}

/**
 * `satReference` strings run from hundreds to thousands of characters (verified
 * byte-accurate against SAT sources earlier this session — see the task brief) and are the
 * product's actual legal liability shield: every finding must stay traceable to its exact
 * citation, verbatim, never paraphrased. So this component only ever controls DISCLOSURE
 * (collapsed preview vs. full text) — it never truncates permanently and never rewrites a
 * single character of the string it's given.
 */
export function SatReferenceDisclosure({ satReference }: SatReferenceDisclosureProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentId = useId();
  const isLong = satReference.length > PREVIEW_LENGTH;
  const preview = isLong ? `${satReference.slice(0, PREVIEW_LENGTH).trimEnd()}…` : satReference;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(satReference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser; the full citation is already
      // visible on screen (selectable/copyable by hand) so this is a nice-to-have, not
      // load-bearing -- silently doing nothing on failure is fine here.
    }
  }

  return (
    <div className="mt-2 border-l-2 border-[var(--hairline-strong)] pl-3">
      <p className="font-mono-data text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
        Fundamento SAT
      </p>
      <p
        id={contentId}
        className={cn(
          "font-serif-doc mt-1.5 text-[13.5px] leading-relaxed text-[var(--ink-soft)]",
          isOpen && "max-h-72 overflow-y-auto pr-2",
        )}
      >
        {isOpen ? satReference : preview}
      </p>
      {isLong ? (
        <div className="mt-2 flex items-center gap-4">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={contentId}
            onClick={() => setIsOpen((v) => !v)}
            className="font-mono-data inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--azul)] hover:text-[var(--azul-deep)]"
          >
            <ChevronDown className={cn("size-3 transition-transform", isOpen && "rotate-180")} />
            {isOpen ? "Ocultar cita completa" : `Ver cita completa (${satReference.length.toLocaleString("es-MX")} caracteres)`}
          </button>
          {isOpen ? (
            <button
              type="button"
              onClick={handleCopy}
              className="font-mono-data inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)] hover:text-[var(--ink)]"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copiada" : "Copiar cita"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
