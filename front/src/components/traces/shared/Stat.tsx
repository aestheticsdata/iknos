import { cn } from "@lib/utils";

import type { ReactNode } from "react";

/**
 * A kicker over a value — the run list's headline numbers and the run detail's summary grid.
 * Mono and tabular, because these are read against each other.
 */
export const Stat = ({ label, value, hint, tone }: StatProps) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <span className="text-kicker tracking-kicker text-work-text-dim uppercase">{label}</span>
    <span className={cn("truncate text-dense font-medium tabular-nums", tone ?? "text-work-text")}>{value}</span>
    {hint !== undefined && <span className="truncate text-micro text-work-text-dim">{hint}</span>}
  </div>
);

type StatProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** A text colour class, for the one number that should stand out. */
  tone?: string;
};
