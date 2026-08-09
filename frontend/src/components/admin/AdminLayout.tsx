// Shell for every protected /admin panel: top nav between the four panels plus
// "Cerrar sesión". Rendered by App.tsx behind ProtectedRoute, so everything reachable
// through this shell is already known-authenticated -- individual panels don't need to
// re-check the session themselves.
import { NavLink, Outlet, useNavigate } from "react-router";
import { toast } from "sonner";
import { Cpu, FileText, ListChecks, Gauge, LogOut } from "lucide-react";
import { useAdminAuth } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/admin/models", label: "Modelos", icon: Cpu },
  { to: "/admin/prompts", label: "Prompts", icon: FileText },
  { to: "/admin/jobs", label: "Trabajos", icon: ListChecks },
  { to: "/admin/llm-calls", label: "Llamadas LLM", icon: Gauge },
];

export function AdminLayout() {
  const { logout } = useAdminAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    toast.success("Sesión cerrada.");
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">CFDI Risk Auditor</span>
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Admin
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut />
            Cerrar sesión
          </Button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
