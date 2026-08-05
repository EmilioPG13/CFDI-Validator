import SectionHeading from './SectionHeading'

const PAINS = [
  {
    num: 'i',
    title: 'El cierre mensual se vuelve una revisión XML por XML',
    body: 'Con varios RFCs a tu cargo, cada cierre implica abrir cientos —a veces miles— de XML, verificar folio por folio y cruzar contra el portal del SAT a mano. Es trabajo de horas que se repite cada mes, cliente por cliente, y donde basta un descuido para que algo se pase.',
  },
  {
    num: 'ii',
    title: 'La factura que dedujiste… y el proveedor canceló después',
    body: 'El CFDI era válido cuando lo recibiste, pero el proveedor lo canceló semanas después y nadie te avisó. Te enteras hasta que el SAT lo señala en una revisión, cuando corregir la deducción ya cuesta mucho más: actualizaciones, recargos y una conversación incómoda con tu cliente.',
  },
  {
    num: 'iii',
    title: 'El proveedor 69-B que nadie detectó a tiempo',
    body: 'Un proveedor entra a la lista de EFOS y, de pronto, todas las operaciones que le dedujiste quedan bajo presunción de inexistencia. Detectarlo a mano significa buscar cada RFC en la lista del SAT, cada mes, para cada cliente. En la práctica, casi nadie lo hace.',
  },
]

export default function Pain() {
  return (
    <section id="problema" className="border-b border-[var(--hairline)]">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
        <SectionHeading
          number="01"
          label="El problema"
          title="El riesgo fiscal no está en lo que ves. Está en lo que cambió después."
        />

        <p className="font-serif-doc mt-8 max-w-3xl text-xl leading-relaxed text-[var(--ink)] sm:text-[1.35rem]">
          Tu trabajo es cerrar bien y a tiempo. Pero el estado de un CFDI y la situación de un
          proveedor pueden cambiar después de que ya dedujiste — y revisarlo todo a mano,
          cada mes, simplemente no escala.
        </p>

        <div className="mt-12 grid gap-px border border-[var(--hairline-strong)] bg-[var(--hairline)] lg:grid-cols-3">
          {PAINS.map((pain) => (
            <article key={pain.num} className="bg-[var(--paper)] p-7 sm:p-8">
              <span className="font-serif-doc text-3xl text-[var(--azul)]">{pain.num}.</span>
              <h3 className="font-display mt-4 text-[17px] font-bold leading-snug text-[var(--ink)]">
                {pain.title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--ink-soft)]">{pain.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
