export default function Testimonials() {
  return (
    <section id="voces" className="border-b border-[var(--hairline)]">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
        <div className="border-t border-[var(--hairline-strong)] pt-5">
          <p className="font-mono-data text-[11px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
            05 <span className="mx-2 text-[var(--hairline-strong)]">/</span> Lo que dirán los contadores
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h2 className="font-display text-2xl font-bold leading-tight tracking-tight text-[var(--ink)] sm:text-3xl">
              Todavía no inventamos testimonios.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--ink-soft)]">
              CFDI Risk Auditor es un producto nuevo, en desarrollo activo. Preferimos este
              espacio vacío antes que una frase bonita firmada por alguien que no existe.
              Cuando despachos reales lo usen en cierres reales, sus palabras irán aquí — con
              nombre y RFC del despacho, verificables.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:col-span-8">
            {[1, 2].map((slot) => (
              <div
                key={slot}
                className="corner-box flex min-h-44 flex-col justify-between border border-dashed border-[var(--hairline-strong)] bg-[var(--paper-raised)] p-6"
              >
                <span className="cb-extra" aria-hidden="true" />
                <p className="font-mono-data text-[11px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                  [TESTIMONIO]
                </p>
                <p className="mt-4 text-[13px] leading-relaxed text-[var(--ink-faint)]">
                  Espacio reservado para la experiencia de un contador o despacho participante
                  del programa de acceso anticipado.
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
