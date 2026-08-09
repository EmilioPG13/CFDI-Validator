// Session context for the admin console (/admin/*). A single provider, mounted once at
// the top of the /admin route subtree in App.tsx, so the login page and every protected
// panel share one /auth/me check instead of each re-deriving it. See backendApi.ts's own
// header comment for why getSession()/logout() live in a hand-mirrored client rather than
// importing backend/ types directly.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getSession, logout as logoutRequest, type SessionUser } from "@/lib/backendApi";

export type AdminAuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: SessionUser }
  | { status: "unauthenticated" };

interface AdminAuthContextValue {
  state: AdminAuthState;
  /** Re-runs the /auth/me check. Call after a successful login so the ProtectedRoute
   *  tree picks up the new session cookie without a full page reload. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminAuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const { user } = await getSession();
      setState(
        user && user.role === "ADMIN" ? { status: "authenticated", user } : { status: "unauthenticated" },
      );
    } catch {
      // A network/server error on the session check is treated the same as "not logged
      // in" -- there's nothing else useful to show on a check the user didn't initiate.
      setState({ status: "unauthenticated" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setState({ status: "unauthenticated" });
    }
  }, []);

  return <AdminAuthContext.Provider value={{ state, refresh, logout }}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  return ctx;
}
