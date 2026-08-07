import { Link } from 'react-router'

export default function FinalCta() {
  return (
    <section id="demo" className="border-b border-[var(--hairline)]">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-28">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="font-mono-data text-[11px] uppercase tracking-[0.22em] text-[var(--azul)]">
              06 <span className="mx-2 text-[var(--hairline-strong)]">/</span> Pruébalo ahora
            </p>
            <h2 className="font-display mt-5 text-3xl font-extrabold leading-[1.05] tracking-tight text-[var(--ink)] sm:text-4xl lg:text-[3rem]">
              Audita un lote de ejemplo en menos de un minuto.
            </h2>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-[var(--ink-soft)]">
              La demo incluye un ZIP con XML de muestra —incluyendo casos de CFDI cancelados y un
              proveedor en la lista 69-B— para que veas el reporte completo tal como lo recibirías
              en tu cierre. Sin crear cuenta, sin dejar tu correo, sin instalar nada.
            </p>
          </div>

          <div className="lg:col-span-5">
            <div className="corner-box bg-[var(--paper-raised)] p-7 sm:p-8">
              <span className="cb-extra" aria-hidden="true" />
              <Link
                to="/auditoria?demo=1"
                className="block bg-[var(--azul)] px-6 py-4 text-center text-[16px] font-semibold text-white transition-colors hover:bg-[var(--azul-deep)]"
              >
                Abrir la demo con datos de ejemplo
              </Link>
              <dl className="font-mono-data mt-6 space-y-2.5 text-[11px] uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                <div className="flex justify-between gap-4 border-b border-[var(--hairline)] pb-2.5">
                  <dt>Registro</dt>
                  <dd className="text-[var(--verde)]">No requerido</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-[var(--hairline)] pb-2.5">
                  <dt>e.firma / CIEC</dt>
                  <dd className="text-[var(--verde)]">Nunca se piden</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-[var(--hairline)] pb-2.5">
                  <dt>Datos</dt>
                  <dd>Ejemplos ficticios incluidos</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Instalación</dt>
                  <dd>Ninguna — corre en el navegador</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
