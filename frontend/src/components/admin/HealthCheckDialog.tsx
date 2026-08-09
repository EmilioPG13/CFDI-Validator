// Per-model, per-role "Probar salud" action from the ModelCatalog panel. Opens a dialog
// immediately (loading state), then fills in the ModelHealthCheck result once
// runHealthCheck() resolves -- a real NIM call, can take a few seconds.
import { useState } from "react";
import type { ReactNode } from "react";
import { Stethoscope, CircleAlert } from "lucide-react";
import {
  runHealthCheck,
  BackendApiError,
  type LlmRoleName,
  type HealthProbeResult,
} from "@/lib/backendApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ROLE_LABEL: Record<LlmRoleName, string> = { EXPLAINER: "Explainer", VERIFIER: "Verifier" };

type ProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: HealthProbeResult }
  | { status: "error"; message: string };

interface HealthCheckDialogProps {
  modelId: string;
}

export function HealthCheckDialog({ modelId }: HealthCheckDialogProps) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<LlmRoleName>("EXPLAINER");
  const [state, setState] = useState<ProbeState>({ status: "idle" });

  function openFor(nextRole: LlmRoleName) {
    setRole(nextRole);
    setOpen(true);
    setState({ status: "loading" });
    runHealthCheck(modelId, nextRole)
      .then((result) => setState({ status: "done", result }))
      .catch((err) =>
        setState({
          status: "error",
          message: err instanceof BackendApiError ? err.message : "No se pudo ejecutar la prueba.",
        }),
      );
  }

  return (
    <>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="outline" onClick={() => openFor("EXPLAINER")}>
          <Stethoscope className="size-3.5" />
          Explainer
        </Button>
        <Button size="sm" variant="outline" onClick={() => openFor("VERIFIER")}>
          <Stethoscope className="size-3.5" />
          Verifier
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono-data text-base break-all">{modelId}</DialogTitle>
            <DialogDescription>Prueba de salud como {ROLE_LABEL[role]}</DialogDescription>
          </DialogHeader>

          {state.status === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Ejecutando prueba contra NIM…
            </div>
          ) : null}

          {state.status === "error" ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}

          {state.status === "done" ? <HealthResult result={state.result} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function HealthResult({ result }: { result: HealthProbeResult }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <ResultField label="Alcanzable" value={<BoolBadge value={result.reachable} />} />
        <ResultField
          label="Admite JSON Schema"
          value={<BoolBadge value={result.supportsJsonSchema} />}
          hint="El campo más importante: si es falso, el modelo responde en prosa y rompe el pipeline de Explainer/Verifier."
        />
        <ResultField label="Latencia" value={result.latencyMs !== null ? `${result.latencyMs} ms` : "—"} />
        <ResultField
          label="Responde en español"
          value={result.spanishOk === null ? "—" : <BoolBadge value={result.spanishOk} />}
        />
      </div>
      {result.sample ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Muestra de respuesta</p>
          <pre className="max-h-40 overflow-auto rounded-md border bg-muted p-2 text-xs whitespace-pre-wrap font-mono-data">
            {result.sample}
          </pre>
        </div>
      ) : null}
      {result.error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error reportado por la prueba</AlertTitle>
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function ResultField({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div>{value}</div>
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function BoolBadge({ value }: { value: boolean }) {
  return (
    <Badge variant="outline" className={value ? "bg-emerald-600 text-white" : "bg-destructive text-white"}>
      {value ? "Sí" : "No"}
    </Badge>
  );
}
