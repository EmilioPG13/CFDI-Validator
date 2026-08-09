// Gate for every panel under /admin except /admin/login itself. Waits for the
// AdminAuthProvider's initial /auth/me check to settle before rendering anything, so
// there's never a flash of protected content (rendering children before we know the
// session is valid) nor a flash of the login redirect (redirecting before we know the
// session is valid too).
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAdminAuth } from "@/lib/adminAuth";
import { Spinner } from "@/components/ui/spinner";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { state } = useAdminAuth();
  const location = useLocation();

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Verificando sesión…
        </div>
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
