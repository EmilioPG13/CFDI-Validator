// /admin/llm-calls -- raw call log (filterable, paginated) plus a totals-by-model
// summary. Token counts only, deliberately: NIM doesn't expose per-token pricing, so no
// dollar figure is fabricated anywhere here.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Gauge } from "lucide-react";
import {
  listLlmCalls,
  getLlmCallTotals,
  BackendApiError,
  type LlmCallRecord,
  type LlmCallTotals,
  type LlmRoleName,
} from "@/lib/backendApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LIMIT = 25;
const PURPOSE_LABEL: Record<string, string> = { PRODUCTION: "Producción", HEALTH_CHECK: "Prueba de salud" };

export default function LlmCallsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Llamadas LLM</h1>
        <p className="text-sm text-muted-foreground">
          Registro de llamadas a NIM (Explainer/Verifier + pruebas de salud). Solo conteo de tokens —
          NIM no expone precio por token, así que no se muestra una cifra de costo.
        </p>
      </div>
      <TotalsSummary />
      <CallsTable />
    </div>
  );
}

function TotalsSummary() {
  const [totals, setTotals] = useState<LlmCallTotals[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getLlmCallTotals()
      .then((res) => {
        if (!cancelled) setTotals(res.totals);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof BackendApiError ? err.message : "No se pudieron cargar los totales.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grandTotals = useMemo(() => {
    if (!totals) return null;
    return totals.reduce(
      (acc, t) => ({
        callCount: acc.callCount + t.callCount,
        promptTokens: acc.promptTokens + t.promptTokens,
        completionTokens: acc.completionTokens + t.completionTokens,
      }),
      { callCount: 0, promptTokens: 0, completionTokens: 0 },
    );
  }, [totals]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Totales por modelo</CardTitle>
        <CardDescription>Agrupado por modelo, rol y propósito.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !totals || totals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin llamadas registradas todavía.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Propósito</TableHead>
                <TableHead className="text-right">Llamadas</TableHead>
                <TableHead className="text-right">Tokens prompt</TableHead>
                <TableHead className="text-right">Tokens respuesta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.map((t) => (
                <TableRow key={`${t.modelId}:${t.role}:${t.purpose}`}>
                  <TableCell className="font-mono-data">{t.modelId}</TableCell>
                  <TableCell>{t.role}</TableCell>
                  <TableCell>{PURPOSE_LABEL[t.purpose] ?? t.purpose}</TableCell>
                  <TableCell className="text-right">{t.callCount}</TableCell>
                  <TableCell className="text-right">{t.promptTokens}</TableCell>
                  <TableCell className="text-right">{t.completionTokens}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {grandTotals ? (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right">{grandTotals.callCount}</TableCell>
                  <TableCell className="text-right">{grandTotals.promptTokens}</TableCell>
                  <TableCell className="text-right">{grandTotals.completionTokens}</TableCell>
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CallsTable() {
  const [role, setRole] = useState<LlmRoleName | "all">("all");
  const [purpose, setPurpose] = useState<"PRODUCTION" | "HEALTH_CHECK" | "all">("all");
  const [modelIdInput, setModelIdInput] = useState("");
  const [appliedModelId, setAppliedModelId] = useState("");
  const [offset, setOffset] = useState(0);
  const [calls, setCalls] = useState<LlmCallRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listLlmCalls({
        role: role === "all" ? undefined : role,
        purpose: purpose === "all" ? undefined : purpose,
        modelId: appliedModelId || undefined,
        limit: LIMIT,
        offset,
      });
      setCalls(res.calls);
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : "No se pudieron cargar las llamadas LLM.");
    } finally {
      setLoading(false);
    }
  }, [role, purpose, appliedModelId, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setAppliedModelId(modelIdInput.trim());
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registro de llamadas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Rol</Label>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v as LlmRoleName | "all");
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="EXPLAINER">EXPLAINER</SelectItem>
                <SelectItem value="VERIFIER">VERIFIER</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Propósito</Label>
            <Select
              value={purpose}
              onValueChange={(v) => {
                setPurpose(v as "PRODUCTION" | "HEALTH_CHECK" | "all");
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="PRODUCTION">Producción</SelectItem>
                <SelectItem value="HEALTH_CHECK">Prueba de salud</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="modelId">Modelo</Label>
            <Input
              id="modelId"
              value={modelIdInput}
              onChange={(event) => setModelIdInput(event.target.value)}
              placeholder="ID de modelo…"
              className="w-56 font-mono-data"
            />
          </div>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
        </form>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : calls.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Gauge />
              </EmptyMedia>
              <EmptyTitle>Sin llamadas</EmptyTitle>
              <EmptyDescription>
                {appliedModelId || role !== "all" || purpose !== "all"
                  ? "Ninguna llamada coincide con estos filtros."
                  : "Todavía no se ha registrado ninguna llamada a un modelo."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rol</TableHead>
                  <TableHead>Propósito</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Trabajo</TableHead>
                  <TableHead className="text-right">Tokens prompt</TableHead>
                  <TableHead className="text-right">Tokens respuesta</TableHead>
                  <TableHead className="text-right">Latencia</TableHead>
                  <TableHead>Creada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.role}</TableCell>
                    <TableCell>{PURPOSE_LABEL[c.purpose] ?? c.purpose}</TableCell>
                    <TableCell className="font-mono-data">{c.modelId}</TableCell>
                    <TableCell className="font-mono-data text-muted-foreground">{c.jobId ?? "—"}</TableCell>
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

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {offset + 1}–{offset + calls.length} de {total}
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
  );
}
