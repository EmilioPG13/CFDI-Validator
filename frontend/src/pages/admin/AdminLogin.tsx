// /admin/login -- email+password form. On success, redirects to wherever the user was
// trying to go (ProtectedRoute stashes that in location.state.from), or /admin/models by
// default. A non-ADMIN account can authenticate against /auth/login just fine (it's a
// valid User row) but is refused here, client-side, since the admin console has nothing
// for a USER role to see.
import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ShieldCheck, CircleAlert } from "lucide-react";
import { login, BackendApiError } from "@/lib/backendApi";
import { useAdminAuth } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export default function AdminLogin() {
  const { state, refresh } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? "/admin";

  // Already logged in as admin (e.g. navigated here directly with a valid session
  // cookie) -- skip the form entirely.
  if (state.status === "authenticated") {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(email, password);
      if (user.role !== "ADMIN") {
        setError("Esta cuenta no tiene permisos de administrador.");
        setSubmitting(false);
        return;
      }
      await refresh();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof BackendApiError ? err.message : "No se pudo conectar con el servidor.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </div>
          <h1 className="text-lg font-semibold">CFDI Risk Auditor</h1>
          <p className="text-sm text-muted-foreground">Consola de administración</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>No se pudo iniciar sesión</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Spinner className="size-4" /> : null}
            Iniciar sesión
          </Button>
        </form>
      </div>
    </div>
  );
}
