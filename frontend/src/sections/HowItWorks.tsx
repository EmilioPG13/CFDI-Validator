import SectionHeading from './SectionHeading'

const STEPS = [
  {
    num: '01',
    title: 'Arrastras el ZIP del SAT',
    body: 'El mismo ZIP de XML que ya descargas del portal del SAT con tu sesión. No conectamos con tu buzón tributario ni pedimos acceso a nada: tú eliges el archivo, como quien adjunta un documento a un correo.',
    meta: 'Entrada: ZIP de XML · CFDI 4.0',
  },
  {
    num: '02',
    title: 'Se valida y cruza en tu navegador',
    body: 'El motor de validación se ejecuta localmente, dentro de tu navegador: verifica la estructura y el sello de cada XML, consulta su estado de cancelación y cruza cada RFC emisor contra la lista 69-B del SAT vigente.',
    meta: 'Procesamiento: 100% local · WebAssembly',
  },
  {
    num: '03',
    title: 'Recibes un reporte de riesgo fundado',
    body: 'Cada hallazgo llega explicado y citando la regla o el artículo exacto —Art. 29-A y 69-B del CFF, entre otros— con el folio fiscal, el RFC y el monto afectado. Listo para documentar tu cierre o para hablar con tu cliente.',
    meta: 'Salida: reporte con fundamento por hallazgo',
  },
]

export default function HowItWorks() {
  return (
    <section id="como-funciona" className="border-b border-[var(--hairline)] bg-[var(--paper-raised)]">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
        <SectionHeading
          number="02"
          label="Cómo funciona"
          title="Tres pasos. Ninguno implica entregar tus credenciales."
        />

        <ol className="mt-12">
          {STEPS.map((step, i) => (
            <li
              key={step.num}
              className={`grid gap-4 border-t border-[var(--hairline-strong)] py-8 sm:grid-cols-12 sm:gap-8 lg:py-10 ${
                i === STEPS.length - 1 ? 'border-b' : ''
              }`}
            >
              <div className="sm:col-span-2">
                <span className="font-mono-data text-sm text-[var(--azul)]">/{step.num}</span>
              </div>
              <div className="sm:col-span-4">
                <h3 className="font-display text-xl font-bold leading-snug text-[var(--ink)] sm:text-[1.35rem]">
                  {step.title}
                </h3>
              </div>
              <div className="sm:col-span-6">
                <p className="max-w-xl text-[15px] leading-relaxed text-[var(--ink-soft)]">{step.body}</p>
                <p className="font-mono-data mt-3 text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  {step.meta}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
