// /admin/jobs -- read-only queue monitor (nothing here mutates a Job; see
// backend/src/routes/admin/jobs.ts's own header comment). Filters by status/batchId,
// offset-based pagination, row click navigates to the detail view.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { listJobs, BackendApiError, type JobSummary } from "@/lib/backendApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/admin/StatusBadge";

const STATUS_OPTIONS = ["pending", "processing", "done", "rejected", "failed"];
const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  processing: "Procesando",
  done: "Completado",
  rejected: "Rechazado",
  failed: "Fallido",
};
const LIMIT = 25;

export default function JobsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("all");
  const [batchIdInput, setBatchIdInput] = useState("");
  const [appliedBatchId, setAppliedBatchId] = useState("");
  const [offset, setOffset] = useState(0);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listJobs({
        status: status === "all" ? undefined : status,
        batchId: appliedBatchId || undefined,
        limit: LIMIT,
        offset,
      });
      setJobs(res.jobs);
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : "No se pudieron cargar los trabajos.");
    } finally {
      setLoading(false);
    }
  }, [status, appliedBatchId, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleStatusChange(value: string) {
    setStatus(value);
    setOffset(0);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setAppliedBatchId(batchIdInput.trim());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Trabajos</h1>
        <p className="text-sm text-muted-foreground">Cola de generación de explicaciones (Explainer/Verifier).</p>
      </div>

      <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Estado</Label>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="batchId">ID de lote</Label>
          <Input
            id="batchId"
            value={batchIdInput}
            onChange={(event) => setBatchIdInput(event.target.value)}
            placeholder="batch_…"
            className="w-56 font-mono-data"
          />
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{total} trabajos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListChecks />
                </EmptyMedia>
                <EmptyTitle>Sin trabajos</EmptyTitle>
                <EmptyDescription>
                  {appliedBatchId || status !== "all"
                    ? "Ningún trabajo coincide con estos filtros."
                    : "Todavía no se ha encolado ningún trabajo."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Regla</TableHead>
                    <TableHead className="text-right">Intentos</TableHead>
                    <TableHead>Actualizado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow
                      key={job.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/admin/jobs/${job.id}`)}
                    >
                      <TableCell className="font-mono-data">{job.id}</TableCell>
                      <TableCell className="font-mono-data text-muted-foreground">{job.batchId}</TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="font-mono-data">{job.findingRuleId}</TableCell>
                      <TableCell className="text-right">{job.attempts}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(job.updatedAt).toLocaleString("es-MX")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {offset + 1}–{offset + jobs.length} de {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
                    disabled={offset === 0}
                  >
                    <ChevronLeft className="size-4" />
                    Anterior
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOffset((o) => o + LIMIT)}
                    disabled={offset + LIMIT >= total}
                  >
                    Siguiente
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
