import SectionHeading from './SectionHeading'

function CrossIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true" className="mt-1 shrink-0 text-[var(--rojo)]">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true" className="mt-1 shrink-0 text-[var(--verde)]">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  )
}

const ROWS: { aspecto: string; otras: string; nosotros: string }[] = [
  {
    aspecto: 'Credenciales',
    otras: 'Piden tu e.firma, tu CIEC o tus contraseñas del SAT para "descargar por ti".',
    nosotros: 'Nunca las pedimos. No hay campo en la app donde siquiera puedas escribirlas.',
  },
  {
    aspecto: 'Tus archivos',
    otras: 'Tus XML —con RFCs, montos y datos de tus clientes— se suben a servidores de terceros.',
    nosotros: 'El análisis corre en tu navegador. El ZIP y los XML no salen de tu computadora.',
  },
  {
    aspecto: 'Riesgo de filtración',
    otras: 'Si el proveedor de la herramienta es vulnerado, tus credenciales fiscales se van con él.',
    nosotros: 'No guardamos lo que nunca nos diste: no hay e.firma ni XML que filtrar.',
  },
  {
    aspecto: 'Responsabilidad',
    otras: 'Delegar tu e.firma a terceros compromete tu control sobre la firma electrónica.',
    nosotros: 'La e.firma se queda donde debe estar: únicamente bajo tu resguardo.',
  },
]

export default function Comparison() {
  return (
    <section id="diferencia" className="border-b border-[var(--hairline)]">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
        <SectionHeading
          number="03"
          label="La diferencia"
          title="Otras herramientas empiezan pidiéndote las llaves. Nosotros empezamos por no pedirlas."
          intro="La mayoría de las soluciones de descarga y auditoría masiva de CFDI funcionan con tus credenciales del SAT. Ese es exactamente el problema que decidimos no heredar."
        />

        <div className="mt-12 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--hairline-strong)]">
                <th className="font-mono-data w-[18%] py-3 pr-4 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-faint)]">
                  Aspecto
                </th>
                <th className="font-mono-data w-[41%] py-3 pr-4 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--rojo)]">
                  Otras herramientas
                </th>
                <th className="font-mono-data w-[41%] py-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--verde)]">
                  CFDI Risk Auditor
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.aspecto} className="border-b border-[var(--hairline)] align-top">
                  <td className="py-5 pr-4">
                    <span className="font-display text-[14px] font-bold text-[var(--ink)]">{row.aspecto}</span>
                  </td>
                  <td className="py-5 pr-4">
                    <div className="flex gap-2.5">
                      <CrossIcon />
                      <p className="text-[14px] leading-relaxed text-[var(--ink-soft)]">{row.otras}</p>
                    </div>
                  </td>
                  <td className="py-5">
                    <div className="flex gap-2.5">
                      <CheckIcon />
                      <p className="text-[14px] leading-relaxed text-[var(--ink)]">{row.nosotros}</p>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="font-serif-doc mt-10 max-w-3xl text-lg leading-relaxed text-[var(--ink)] sm:text-xl">
          Si una herramienta necesita tu e.firma para funcionar, el riesgo no desapareció:
          solo cambió de lugar. Preferimos construir una herramienta que no lo necesita.
        </p>
      </div>
    </section>
  )
}
