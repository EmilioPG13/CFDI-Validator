// /admin/jobs/:id -- single Job with its JobEvent timeline and associated LlmCall rows.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { getJob, BackendApiError, type JobDetail } from "@/lib/backendApi";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/admin/StatusBadge";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJob(id)
      .then((res) => {
        if (!cancelled) setJob(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof BackendApiError ? err.message : "No se pudo cargar el trabajo.";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="space-y-6">
      <Link
        to="/admin/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a trabajos
      </Link>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {job ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="font-mono-data text-base break-all">{job.id}</CardTitle>
              <CardDescription>
                Lote <span className="font-mono-data">{job.batchId}</span> · Regla{" "}
                <span className="font-mono-data">{job.findingRuleId}</span>
              </CardDescription>
              <CardAction>
                <StatusBadge status={job.status} />
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Intentos" value={String(job.attempts)} />
              <Field label="Creado" value={new Date(job.createdAt).toLocaleString("es-MX")} />
              <Field label="Actualizado" value={new Date(job.updatedAt).toLocaleString("es-MX")} />
              <Field label="Reclamado" value={job.claimedAt ? new Date(job.claimedAt).toLocaleString("es-MX") : "—"} />
              {job.lastError ? (
                <Field label="Último error" value={job.lastError} full className="text-destructive" />
              ) : null}
              {job.explanation ? <Field label="Explicación" value={job.explanation} full /> : null}
              {job.suggestedFix ? <Field label="Corrección sugerida" value={job.suggestedFix} full /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historial de eventos</CardTitle>
              <CardDescription>{job.events.length} eventos.</CardDescription>
            </CardHeader>
            <CardContent>
              {job.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin eventos registrados.</p>
              ) : (
                <ol className="space-y-3">
                  {job.events.map((ev) => (
                    <li key={ev.id} className="border-l-2 border-border pl-3">
                      <p className="text-sm">
                        {ev.fromStatus ? (
                          <span className="font-mono-data">{ev.fromStatus}</span>
                        ) : (
                          <span className="text-muted-foreground">(inicio)</span>
                        )}
                        {" → "}
                        <span className="font-mono-data font-medium">{ev.toStatus}</span>
                      </p>
                      {ev.reason ? <p className="text-xs text-muted-foreground">{ev.reason}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        {new Date(ev.createdAt).toLocaleString("es-MX")}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Llamadas LLM</CardTitle>
              <CardDescription>{job.llmCalls.length} llamadas asociadas a este trabajo.</CardDescription>
            </CardHeader>
            <CardContent>
              {job.llmCalls.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin llamadas LLM registradas para este trabajo.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rol</TableHead>
                      <TableHead>Propósito</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead className="text-right">Tokens prompt</TableHead>
                      <TableHead className="text-right">Tokens respuesta</TableHead>
                      <TableHead className="text-right">Latencia</TableHead>
                      <TableHead>Creada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {job.llmCalls.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.role}</TableCell>
                        <TableCell>{c.purpose}</TableCell>
                        <TableCell className="font-mono-data">{c.modelId}</TableCell>
                        <TableCell className="text-right">{c.promptTokens}</TableCell>
                        <TableCell className="text-right">{c.completionTokens}</TableCell>
                        <TableCell className="text-right">{c.latencyMs} ms</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(c.createdAt).toLocaleString("es-MX")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: ReactNode;
  full?: boolean;
  className?: string;
}

function Field({ label, value, full, className }: FieldProps) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`text-sm whitespace-pre-wrap ${className ?? ""}`}>{value}</p>
    </div>
  );
}
