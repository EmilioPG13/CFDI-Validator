// /admin/prompts -- version history + activation for the two known prompt keys
// (explainer.system, verifier.system). createPromptVersion() has no validation -- an
// admin can save a work-in-progress draft on purpose. activatePromptVersion() DOES
// enforce structural safety (assertPromptStructurallySafe on the backend) and can 400
// with a specific missing-section message; that's a real guardrail, surfaced verbatim
// via toast rather than reworded.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { CircleAlert } from "lucide-react";
import {
  listPromptKeys,
  getPromptVersions,
  createPromptVersion,
  activatePromptVersion,
  deletePromptVersion,
  BackendApiError,
  type PromptVersionRecord,
  type PromptResolution,
} from "@/lib/backendApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function PromptVersionsPage() {
  const [keys, setKeys] = useState<string[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listPromptKeys();
        if (cancelled) return;
        setKeys(res.keys);
        setSelectedKey((prev) => prev ?? res.keys[0] ?? null);
      } catch (err) {
        toast.error(
          err instanceof BackendApiError ? err.message : "No se pudieron cargar las claves de prompt.",
        );
      } finally {
        if (!cancelled) setKeysLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Prompts</h1>
        <p className="text-sm text-muted-foreground">
          Versiones de los prompts de sistema para Explainer y Verifier.
        </p>
      </div>

      {keysLoading ? (
        <Skeleton className="h-9 w-72" />
      ) : keys.length === 0 ? (
        <Alert>
          <CircleAlert />
          <AlertTitle>Sin claves de prompt</AlertTitle>
          <AlertDescription>El backend no reportó ninguna clave de prompt versionable.</AlertDescription>
        </Alert>
      ) : (
        <Tabs value={selectedKey ?? keys[0]} onValueChange={setSelectedKey}>
          <TabsList>
            {keys.map((k) => (
              <TabsTrigger key={k} value={k} className="font-mono-data">
                {k}
              </TabsTrigger>
            ))}
          </TabsList>
          {keys.map((k) => (
            <TabsContent key={k} value={k}>
              {selectedKey === k ? <PromptKeyPanel promptKey={k} /> : null}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

interface PromptKeyPanelProps {
  promptKey: string;
}

function PromptKeyPanel({ promptKey }: PromptKeyPanelProps) {
  const [versions, setVersions] = useState<PromptVersionRecord[]>([]);
  const [active, setActive] = useState<PromptResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptVersionRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPromptVersions(promptKey);
      setVersions(res.versions);
      setActive(res.active);
      setDraft(res.active.body);
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : "No se pudo cargar el prompt.");
    } finally {
      setLoading(false);
    }
  }, [promptKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveDraft(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const created = await createPromptVersion(promptKey, draft);
      toast.success(`Borrador guardado como versión ${created.version}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : "No se pudo guardar el borrador.");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(version: PromptVersionRecord) {
    setBusyId(version.id);
    try {
      await activatePromptVersion(version.id);
      toast.success(`Versión ${version.version} activada.`);
      await load();
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : "No se pudo activar la versión.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await deletePromptVersion(deleteTarget.id);
      toast.success(`Versión ${deleteTarget.version} eliminada.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : "No se pudo eliminar la versión.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 pt-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4">
      <Card>
        <CardHeader>
          <CardTitle>Versión activa</CardTitle>
          <CardDescription>
            {active?.source === "stored"
              ? `Versión ${active.version} guardada en la base de datos.`
              : "Sin versión guardada — se usa el prompt por defecto del código. Este es el comportamiento normal si nunca se ha activado una versión para esta clave."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap font-mono-data">
            {active?.body}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de versiones</CardTitle>
          <CardDescription>{versions.length} versiones guardadas.</CardDescription>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay versiones guardadas para esta clave.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versión</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead>Autor</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.version}</TableCell>
                    <TableCell>
                      {v.active ? <Badge>Activa</Badge> : <Badge variant="outline">Inactiva</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(v.createdAt).toLocaleString("es-MX")}
                    </TableCell>
                    <TableCell className="font-mono-data text-sm text-muted-foreground">
                      {v.createdBy ?? "—"}
                    </TableCell>
                    <TableCell>
                      {!v.active ? (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleActivate(v)}
                            disabled={busyId === v.id}
                          >
                            {busyId === v.id ? <Spinner className="size-3.5" /> : null}
                            Activar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(v)}
                            disabled={busyId === v.id}
                          >
                            Eliminar
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo borrador</CardTitle>
          <CardDescription>
            Se guarda como una nueva versión inactiva, sin validar. Actívala desde el historial cuando
            esté lista — activar sí aplica el chequeo estructural.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveDraft} className="space-y-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={14}
              spellCheck={false}
              className="font-mono-data text-xs"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !draft.trim()}>
                {saving ? <Spinner className="size-4" /> : null}
                Guardar borrador
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar versión {deleteTarget?.version}?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
