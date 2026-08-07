import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { auditZip, type BatchAuditReport } from "@/lib/audit";
import { UploadDropzone } from "@/components/audit/UploadDropzone";
import { SampleDataCta } from "@/components/audit/SampleDataCta";
import { ProcessingPanel, type AuditProgress } from "@/components/audit/ProcessingPanel";
import { AuditReport } from "@/components/audit/AuditReport";

const DEMO_ZIP_URL = "/demo/muestra-cfdi.zip";
const DEMO_ZIP_NAME = "muestra-cfdi.zip";

type PageState =
  | { status: "idle" }
  | { status: "processing"; zipName: string; progress: AuditProgress | null; isDemo: boolean }
  | { status: "done"; zipName: string; report: BatchAuditReport; isDemo: boolean }
  | { status: "error"; message: string };

function AuditoriaHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--hairline)] bg-[var(--paper)]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
        <Link to="/" className="flex items-baseline gap-2.5">
          <span className="font-display text-[17px] font-extrabold tracking-tight text-[var(--ink)]">
            CFDI&nbsp;Risk&nbsp;Auditor
          </span>
          <span className="font-mono-data hidden rounded-none border border-[var(--hairline-strong)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--ink-soft)] sm:inline-block">
            Beta
          </span>
        </Link>
        <Link
          to="/"
          className="flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver al inicio
        </Link>
      </div>
    </header>
  );
}

export default function Auditoria() {
  const [state, setState] = useState<PageState>({ status: "idle" });
  const [searchParams, setSearchParams] = useSearchParams();
  const demoAutoTriggered = useRef(false);

  /**
   * The "processing → done/error" tail shared by both entry points below — a real upload
   * and the bundled sample ZIP produce their bytes very differently (a `File` from the
   * dropzone vs. a `fetch()` of a static asset), but from the moment those bytes exist,
   * both paths are identical: same `auditZip` call, same progress callback, same
   * done/error transitions. Keeping that one code path here (rather than duplicating it
   * in `handleFile` and `runDemo`) is what guarantees the demo produces a report through
   * the exact same pipeline a real upload does — never a shortcut/mocked version.
   */
  const runAudit = useCallback(async (zipBytes: Uint8Array, zipName: string, isDemo: boolean) => {
    try {
      const report = await auditZip(zipBytes, (done, total) => {
        setState((prev) =>
          prev.status === "processing" ? { ...prev, progress: { done, total } } : prev,
        );
      });
      setState({ status: "done", zipName, report, isDemo });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Ocurrió un error inesperado al auditar el ZIP.",
      });
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        setState({ status: "error", message: `«${file.name}» no es un archivo .zip.` });
        return;
      }
      setState({ status: "processing", zipName: file.name, progress: null, isDemo: false });
      const zipBytes = new Uint8Array(await file.arrayBuffer());
      await runAudit(zipBytes, file.name, false);
    },
    [runAudit],
  );

  const runDemo = useCallback(async () => {
    setState({ status: "processing", zipName: DEMO_ZIP_NAME, progress: null, isDemo: true });
    try {
      const res = await fetch(DEMO_ZIP_URL);
      if (!res.ok) {
        throw new Error(`No se pudo cargar el ZIP de muestra (HTTP ${res.status}).`);
      }
      const zipBytes = new Uint8Array(await res.arrayBuffer());
      await runAudit(zipBytes, DEMO_ZIP_NAME, true);
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "No se pudo cargar el ejemplo de muestra.",
      });
    }
  }, [runAudit]);

  // Landing-page CTAs link here with `?demo=1` so a single click produces a full report —
  // the "demoable in 60 seconds, no account" pitch only holds if that click doesn't also
  // require finding and pressing a second button. Guarded with a ref (not just the idle
  // check) because StrictMode's dev double-effect would otherwise fire `runDemo` twice —
  // the second call would land mid-"processing" and stomp the first's progress updates.
  useEffect(() => {
    if (demoAutoTriggered.current) return;
    if (searchParams.get("demo") === "1") {
      demoAutoTriggered.current = true;
      void runDemo();
    }
  }, [searchParams, runDemo]);

  const reset = useCallback(() => {
    setState({ status: "idle" });
    if (searchParams.has("demo")) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("demo");
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <div className="flex min-h-screen flex-col">
      <AuditoriaHeader />

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:py-16">
          <div className="border-t border-[var(--hairline-strong)] pt-5">
            <p className="font-mono-data text-[11px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
              Auditoría
            </p>
            <h1 className="font-display mt-5 max-w-2xl text-3xl font-bold leading-[1.08] tracking-tight text-[var(--ink)] sm:text-4xl">
              Sube tu ZIP de CFDI y obtén el reporte de riesgo.
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-[var(--ink-soft)]">
              El mismo ZIP de XML que ya descargaste del portal del SAT. Todo el análisis corre
              en tu navegador — nada se sube salvo la consulta puntual de cancelación y la
              lista 69-B ante el SAT, por CFDI.
            </p>
          </div>

          <div className="mt-10">
            {state.status === "idle" ? (
              <div>
                <UploadDropzone onFile={handleFile} />
                <SampleDataCta onTry={runDemo} />
              </div>
            ) : null}

            {state.status === "error" ? (
              <div>
                <UploadDropzone onFile={handleFile} error={state.message} />
                <SampleDataCta onTry={runDemo} />
              </div>
            ) : null}

            {state.status === "processing" ? <ProcessingPanel progress={state.progress} /> : null}

            {state.status === "done" ? (
              <AuditReport
                report={state.report}
                zipName={state.zipName}
                isDemo={state.isDemo}
                onReset={reset}
              />
            ) : null}
          </div>
        </div>
      </main>

      <footer className="border-t border-[var(--hairline)]">
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
          <p className="font-mono-data text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            CFDI Risk Auditor · Sin e.firma · Sin contraseñas · Sin envío de XML
          </p>
        </div>
      </footer>
    </div>
  );
}
