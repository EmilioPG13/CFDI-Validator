import { FlaskConical } from "lucide-react";

interface SampleDataCtaProps {
  onTry: () => void;
}

/**
 * Sits below the upload dropzone in the idle/error states — the "no tengo un ZIP a la mano"
 * escape hatch that makes the product demoable in one click, matching the landing page's own
 * "60 segundos, sin cuenta" pitch (Phase 4f). Deliberately a flat hairline block rather than
 * another `corner-box` — it's a secondary action sitting right under the real dropzone, and
 * stacking two identical corner-box treatments would make the sample option compete visually
 * with the primary upload affordance instead of reading as a lighter-weight alternative.
 */
export function SampleDataCta({ onTry }: SampleDataCtaProps) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border border-[var(--hairline)] bg-[var(--paper-raised)] px-5 py-4 sm:px-6">
      <div className="flex items-start gap-3">
        <FlaskConical
          className="mt-0.5 size-5 shrink-0 text-[var(--azul)]"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div>
          <p className="text-[14px] font-semibold leading-snug text-[var(--ink)]">
            ¿No tienes un ZIP a la mano?
          </p>
          <p className="mt-0.5 max-w-md text-[13px] leading-relaxed text-[var(--ink-soft)]">
            Prueba con un lote de muestra: 8 CFDI ficticios, incluyendo un proveedor real de la
            lista 69-B, para ver el reporte completo sin subir nada tuyo.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onTry}
        className="font-mono-data shrink-0 border border-[var(--hairline-strong)] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink)] transition-colors hover:border-[var(--azul)] hover:text-[var(--azul)]"
      >
        Usar datos de muestra
      </button>
    </div>
  );
}
