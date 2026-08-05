const NAV = [
  { href: '#problema', label: 'El problema' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#diferencia', label: 'La diferencia' },
  { href: '#seguridad', label: 'Seguridad' },
]

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--hairline)] bg-[var(--paper)]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
        <a href="#inicio" className="flex items-baseline gap-2.5">
          <span className="font-display text-[17px] font-extrabold tracking-tight text-[var(--ink)]">
            CFDI&nbsp;Risk&nbsp;Auditor
          </span>
          <span className="font-mono-data hidden rounded-none border border-[var(--hairline-strong)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--ink-soft)] sm:inline-block">
            Beta
          </span>
        </a>

        <nav className="hidden items-center gap-7 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[13.5px] font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <a
          href="#demo"
          className="bg-[var(--azul)] px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--azul-deep)]"
        >
          Probar la demo
        </a>
      </div>
    </header>
  )
}
