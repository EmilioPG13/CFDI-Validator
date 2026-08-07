import { useCallback, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { auditZip, type BatchAuditReport } from "@/lib/audit";
import { UploadDropzone } from "@/components/audit/UploadDropzone";
import { ProcessingPanel, type AuditProgress } from "@/components/audit/ProcessingPanel";
import { AuditReport } from "@/components/audit/AuditReport";

type PageState =
  | { status: "idle" }
  | { status: "processing"; zipName: string; progress: AuditProgress | null }
  | { status: "done"; zipName: string; report: BatchAuditReport }
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

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setState({ status: "error", message: `«${file.name}» no es un archivo .zip.` });
      return;
    }

    setState({ status: "processing", zipName: file.name, progress: null });
    try {
      const zipBytes = new Uint8Array(await file.arrayBuffer());
      const report = await auditZip(zipBytes, (done, total) => {
        setState((prev) =>
          prev.status === "processing" ? { ...prev, progress: { done, total } } : prev,
        );
      });
      setState({ status: "done", zipName: file.name, report });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Ocurrió un error inesperado al auditar el ZIP.",
      });
    }
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

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
            {state.status === "idle" ? <UploadDropzone onFile={handleFile} /> : null}

            {state.status === "error" ? (
              <div>
                <UploadDropzone onFile={handleFile} error={state.message} />
              </div>
            ) : null}

            {state.status === "processing" ? <ProcessingPanel progress={state.progress} /> : null}

            {state.status === "done" ? (
              <AuditReport report={state.report} zipName={state.zipName} onReset={reset} />
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
