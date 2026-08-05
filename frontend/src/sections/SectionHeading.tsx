type Props = {
  number: string
  label: string
  title: string
  intro?: string
}

/**
 * Encabezado de sección con numeración tipo oficio: "01 — El problema".
 * Línea fina superior, etiqueta monoespaciada y título en grotesca.
 */
export default function SectionHeading({ number, label, title, intro }: Props) {
  return (
    <div className="border-t border-[var(--hairline-strong)] pt-5">
      <p className="font-mono-data text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {number} <span className="mx-2 text-[var(--hairline-strong)]">/</span> {label}
      </p>
      <h2 className="font-display mt-5 max-w-3xl text-3xl font-bold leading-[1.08] tracking-tight text-[var(--ink)] sm:text-4xl lg:text-[2.75rem]">
        {title}
      </h2>
      {intro ? (
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-[var(--ink-soft)]">{intro}</p>
      ) : null}
    </div>
  )
}
