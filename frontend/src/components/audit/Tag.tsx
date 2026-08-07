import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TagTone = "rojo" | "ambar" | "verde" | "azul" | "neutral";

const TONE_CLASSES: Record<TagTone, string> = {
  rojo: "text-[var(--rojo)] border-[var(--rojo)]",
  ambar: "text-[var(--ambar)] border-[var(--ambar)]",
  verde: "text-[var(--verde)] border-[var(--verde)]",
  azul: "text-[var(--azul)] border-[var(--azul)]",
  neutral: "text-[var(--ink-faint)] border-[var(--hairline-strong)]",
};

interface TagProps {
  tone: TagTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/**
 * Square status tag — same idiom `sections/Hero.tsx`'s `ReportRow` already established for
 * the landing page's report mockup (border + mono uppercase text, no pill/rounded corners:
 * this whole visual system is deliberately square, "technical document" styling, nothing in
 * `sections/*` uses `rounded-*`). Reused here instead of shadcn's `Badge` — that component
 * is `rounded-full` by default, which would be the only rounded element on the site.
 */
export function Tag({ tone, children, icon, className }: TagProps) {
  return (
    <span
      className={cn(
        "font-mono-data inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
