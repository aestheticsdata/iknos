import { cn } from "@lib/utils";

import type { ReactNode } from "react";

/**
 * The detail column's small card — a kicker and a body, the mockup's three right-hand panels.
 *
 * Not `Card`: that one's header is a sans title over a rule, and these are three lines of mono
 * data under a letter-spaced kicker with no rule at all. Sharing the shell here is what keeps the
 * three the same, which is the only thing a column of three cards has to get right.
 */
export const DetailCard = ({ kicker, testId, className, children }: DetailCardProps) => (
  <section
    className={cn(
      "flex flex-none flex-col gap-2 rounded-card border border-work-border bg-work-surface px-3 py-2.5",
      className,
    )}
    data-testid={testId}
  >
    <h4 className="text-kicker tracking-kicker text-work-text-dim uppercase">{kicker}</h4>
    {children}
  </section>
);

type DetailCardProps = {
  kicker: string;
  testId: string;
  className?: string;
  children: ReactNode;
};
