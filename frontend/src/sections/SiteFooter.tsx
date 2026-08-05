export default function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="font-display text-[16px] font-extrabold tracking-tight text-[var(--ink)]">
              CFDI&nbsp;Risk&nbsp;Auditor
            </p>
            <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
              Auditoría en lote de CFDI con procesamiento local. Detecta facturas canceladas y
              proveedores en la lista 69-B del SAT antes de tu cierre mensual.
            </p>
            <p className="font-mono-data mt-4 text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
              Producto nuevo · En desarrollo activo
            </p>
          </div>

          <div className="lg:col-span-3">
            <p className="font-mono-data text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-faint)]">
              Secciones
            </p>
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              <li><a href="#problema" className="text-[var(--ink-soft)] hover:text-[var(--ink)]">El problema</a></li>
              <li><a href="#como-funciona" className="text-[var(--ink-soft)] hover:text-[var(--ink)]">Cómo funciona</a></li>
              <li><a href="#diferencia" className="text-[var(--ink-soft)] hover:text-[var(--ink)]">La diferencia</a></li>
              <li><a href="#seguridad" className="text-[var(--ink-soft)] hover:text-[var(--ink)]">Seguridad</a></li>
              <li><a href="#demo" className="text-[var(--ink-soft)] hover:text-[var(--ink)]">Demo</a></li>
            </ul>
          </div>

          <div className="lg:col-span-4">
            <p className="font-mono-data text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-faint)]">
              Aviso
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-[var(--ink-faint)]">
              CFDI Risk Auditor es una herramienta de apoyo a la revisión y no sustituye el
              criterio profesional del contador ni la consulta directa de los medios oficiales
              del SAT. Los fundamentos citados (arts. 29-A y 69-B del CFF, entre otros) se
              incluyen como referencia para facilitar tu verificación.
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] pt-6">
          <p className="font-mono-data text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            © 2026 CFDI Risk Auditor · Hecho en México
          </p>
          <p className="font-mono-data text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            Sin e.firma · Sin contraseñas · Sin envío de XML
          </p>
        </div>
      </div>
    </footer>
  )
}
