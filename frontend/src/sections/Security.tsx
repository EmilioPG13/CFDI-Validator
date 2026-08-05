const NUNCA = [
  'Tus XML completos ni el ZIP original',
  'RFCs, montos ni datos de tus clientes',
  'Tu e.firma (archivos .cer / .key ni su contraseña)',
  'Tu CIEC ni ninguna contraseña del SAT',
]

const SOLO = [
  'El tipo de regla detectada (p. ej. «proveedor en 69-B»)',
  'El conteo de hallazgos por tipo, para mejorar el producto',
  'Datos técnicos anónimos de rendimiento (tiempos, errores)',
]

export default function Security() {
  return (
    <section id="seguridad" className="border-b border-[var(--hairline)] bg-[var(--azul-deep)] text-white">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
        <div className="border-t border-white/30 pt-5">
          <p className="font-mono-data text-[11px] uppercase tracking-[0.22em] text-white/55">
            04 <span className="mx-2 text-white/30">/</span> Confianza y seguridad
          </p>
          <h2 className="font-display mt-5 max-w-3xl text-3xl font-bold leading-[1.08] tracking-tight sm:text-4xl lg:text-[2.75rem]">
            El análisis ocurre en tu computadora, no en nuestros servidores.
          </h2>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="font-serif-doc text-lg leading-relaxed text-white/90 sm:text-xl">
              «Local-first» significa algo muy concreto: el programa que revisa tus facturas se
              descarga a tu navegador —como se descarga cualquier página web— y ahí se ejecuta,
              usando una tecnología llamada WebAssembly (WASM) que permite correr el motor de
              validación a toda velocidad sin salir de tu equipo.
            </p>
            <p className="mt-5 text-[15px] leading-relaxed text-white/70">
              Cuando arrastras tu ZIP, los archivos se leen y se procesan en la memoria de tu
              propia computadora. Puedes verificarlo: desconéctate de internet después de cargar
              la página y el análisis funciona igual. Lo único que requiere conexión es consultar
              el estado de cancelación y la lista 69-B vigente del SAT.
            </p>
            <p className="font-mono-data mt-6 border-l-2 border-white/30 pl-4 text-[11px] uppercase leading-relaxed tracking-[0.12em] text-white/50">
              Motor de validación compilado a WASM · Cero XML transmitidos · Sesión efímera: al
              cerrar la pestaña, no queda nada
            </p>
          </div>

          <div className="grid gap-px border border-white/25 bg-white/25 sm:grid-cols-2 lg:col-span-7">
            <div className="bg-[var(--azul-deep)] p-7 sm:p-8">
              <p className="font-mono-data text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#e8b4ac]">
                Lo que nunca sale de tu computadora
              </p>
              <ul className="mt-5 space-y-3.5">
                {NUNCA.map((item) => (
                  <li key={item} className="flex gap-3 text-[14.5px] leading-relaxed text-white/85">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-[#e8b4ac]" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[var(--azul-deep)] p-7 sm:p-8">
              <p className="font-mono-data text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#a9cfae]">
                Lo único que podríamos compartir
              </p>
              <ul className="mt-5 space-y-3.5">
                {SOLO.map((item) => (
                  <li key={item} className="flex gap-3 text-[14.5px] leading-relaxed text-white/85">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-[#a9cfae]" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[12.5px] leading-relaxed text-white/55">
                Siempre de forma anónima y agregada. Nunca RFCs, nunca montos, nunca el contenido
                de un XML.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
