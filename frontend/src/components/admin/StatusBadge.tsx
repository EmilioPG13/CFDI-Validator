// Shared status→label/color mapping for Job rows -- used by both the Jobs list table and
// the Job detail page, so the two views never drift. Valid values come from
// backend/prisma/schema.prisma's Job.status comment (a free-text column, no DB enum):
// pending | processing | done | rejected | failed.
import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  processing: "Procesando",
  done: "Completado",
  rejected: "Rechazado",
  failed: "Fallido",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-blue-600 text-white",
  done: "bg-emerald-600 text-white",
  rejected: "bg-destructive text-white",
  failed: "bg-destructive text-white",
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={STATUS_CLASS[status] ?? ""}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
