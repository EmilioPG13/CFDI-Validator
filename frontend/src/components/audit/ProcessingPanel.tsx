export interface AuditProgress {
  done: number;
  total: number;
}

interface ProcessingPanelProps {
  progress: AuditProgress | null;
}

/**
 * `progress === null` covers the gap before `auditZip`'s `onProgress` has fired even once —
 * unzipping plus, on a page's first-ever call, fetching/initializing the XSD validator and
 * catalog bundle over the network (audit.ts's own doc comment: seconds, first call only).
 * Showing an indeterminate state here (rather than a 0/0 bar) is the difference between
 * "still working" and "looks stuck" during that gap.
 */
export function ProcessingPanel({ progress }: ProcessingPanelProps) {
  const hasStarted = progress !== null && progress.total > 0;
  const pct = hasStarted ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="corner-box bg-[var(--paper-raised)] px-6 py-14 text-center sm:px-10">
      <span className="cb-extra" aria-hidden="true" />
      <p className="font-mono-data text-[11px] uppercase tracking-[0.22em] text-[var(--azul)]">
        Procesando
      </p>
      <p className="font-display mt-4 text-xl font-bold leading-snug text-[var(--ink)] sm:text-2xl">
        {hasStarted
          ? `Revisando ${progress.done} de ${progress.total} XML…`
          : "Preparando el motor de validación…"}
      </p>

      <div
        className="mx-auto mt-7 h-2 w-full max-w-md bg-[var(--hairline)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hasStarted ? pct : undefined}
      >
        <div
          className="h-2 bg-[var(--azul)] transition-[width] duration-300 ease-out"
          style={{ width: hasStarted ? `${pct}%` : "12%" }}
        />
      </div>

      <p className="mx-auto mt-6 max-w-md text-[13px] leading-relaxed text-[var(--ink-faint)]">
        {hasStarted
          ? "Validando estructura XSD, catálogos del SAT y — si el CFDI tiene UUID — su estado ante el SAT."
          : "La primera vez tarda unos segundos más: se descargan el validador y los catálogos. Los siguientes lotes en esta sesión son instantáneos."}
      </p>
    </div>
  );
}
