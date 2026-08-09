// /admin/models -- the NIM model catalog (cached server-side, see backendApi.ts's own
// comment on refreshModelCatalog being the only path besides a cold start that makes a
// live NIM call), the resolved model.explainer/model.verifier settings, and a per-model
// health-check action.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Cpu, RefreshCw, Search } from "lucide-react";
import { getModelCatalog, refreshModelCatalog, BackendApiError, type ModelInfo } from "@/lib/backendApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { RoleSettingCard } from "@/components/admin/RoleSettingCard";
import { HealthCheckDialog } from "@/components/admin/HealthCheckDialog";

export default function ModelCatalogPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getModelCatalog();
      setModels(res.models);
      setFetchedAt(res.fetchedAt);
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : "No se pudo cargar el catálogo de modelos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await refreshModelCatalog();
      setModels(res.models);
      setFetchedAt(res.fetchedAt);
      toast.success(`Catálogo actualizado: ${res.models.length} modelos.`);
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : "No se pudo refrescar el catálogo.");
    } finally {
      setRefreshing(false);
    }
  }

  const filteredModels = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((m) => m.id.toLowerCase().includes(needle));
  }, [models, filter]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Catálogo de modelos</h1>
          <p className="text-sm text-muted-foreground">
            Modelos disponibles en NIM
            {fetchedAt ? ` · actualizado ${new Date(fetchedAt).toLocaleString("es-MX")}` : ""}.
          </p>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
          Refrescar catálogo
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RoleSettingCard title="Explainer" settingKey="model.explainer" models={models} modelsLoading={loading} />
        <RoleSettingCard title="Verifier" settingKey="model.verifier" models={models} modelsLoading={loading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Modelos</CardTitle>
          <CardDescription>{models.length} modelos en el catálogo.</CardDescription>
          {models.length > 0 ? (
            <div className="relative mt-2 max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filtrar por ID…"
                className="pl-8"
              />
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : models.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Cpu />
                </EmptyMedia>
                <EmptyTitle>Sin modelos</EmptyTitle>
                <EmptyDescription>Usa «Refrescar catálogo» para consultar NIM.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={handleRefresh} disabled={refreshing} size="sm">
                  {refreshing ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
                  Refrescar catálogo
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Propietario</TableHead>
                  <TableHead className="text-right">Prueba de salud</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredModels.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono-data">{m.id}</TableCell>
                    <TableCell>{m.ownedBy ?? "—"}</TableCell>
                    <TableCell>
                      <HealthCheckDialog modelId={m.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
