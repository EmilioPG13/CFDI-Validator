// One card per LLM role setting (model.explainer / model.verifier): shows the currently
// resolved model + whether it's a stored override or the code default, and a picker to
// change it. putSetting() can legitimately 400 here -- a model not yet health-checked for
// this role, or the same model family picked for both roles -- see
// backend/src/routes/admin/settings.ts. That's a real guardrail, not a bug, so the error
// is surfaced inline rather than swallowed into a generic toast.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CircleAlert } from "lucide-react";
import {
  getSetting,
  putSetting,
  BackendApiError,
  type ModelInfo,
  type SettingResolution,
} from "@/lib/backendApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RoleSettingCardProps {
  title: string;
  settingKey: string;
  models: ModelInfo[];
  modelsLoading: boolean;
}

export function RoleSettingCard({ title, settingKey, models, modelsLoading }: RoleSettingCardProps) {
  const [resolution, setResolution] = useState<SettingResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSetting(settingKey);
      setResolution(res);
      setSelected(res.value);
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : `No se pudo cargar el ajuste ${settingKey}.`);
    } finally {
      setLoading(false);
    }
  }, [settingKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (!selected || selected === resolution?.value) return;
    setSaving(true);
    setError(null);
    try {
      const res = await putSetting(settingKey, selected);
      setResolution(res);
      toast.success(`${title}: modelo actualizado a ${selected}.`);
    } catch (err) {
      setError(err instanceof BackendApiError ? err.message : "No se pudo guardar el ajuste.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Ajuste <code className="font-mono-data">{settingKey}</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : resolution ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono-data text-sm">{resolution.value}</span>
              <Badge variant={resolution.source === "stored" ? "default" : "secondary"}>
                {resolution.source === "stored" ? "Guardado" : "Valor por defecto"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {resolution.source === "stored" && resolution.updatedAt
                ? `Actualizado el ${new Date(resolution.updatedAt).toLocaleString("es-MX")}${resolution.updatedBy ? ` por ${resolution.updatedBy}` : ""}.`
                : "Sin cambios guardados; se usa el valor por defecto del código."}
            </p>

            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
              <Select value={selected} onValueChange={setSelected} disabled={modelsLoading || saving}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Elegir modelo…" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="font-mono-data">
                      {m.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !selected || selected === resolution.value}
              >
                {saving ? <Spinner className="size-4" /> : null}
                Guardar
              </Button>
            </div>

            {error ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>No se pudo guardar</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
