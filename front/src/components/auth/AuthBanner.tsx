import { cn } from "@lib/utils";

const TONE = {
  /** The sealed register screen, and anything else that is a state rather than a failure. */
  warn: "border-l-chassis-warn",
  /** A request that failed. */
  error: "border-l-chassis-error",
  /** Arrived here having just succeeded elsewhere — registered, password reset. */
  ok: "border-l-chassis-accent",
} as const;

/**
 * The banner above a form: a 2px coloured left edge on the chassis' own surface, never a filled
 * block. Colour identifies it at a glance without making a paragraph of text sit on a tinted
 * background, which at 10.5px is the difference between readable and not.
 *
 * `role="status"` rather than `alert`: all three are announced after an action the person just
 * took, and `alert` interrupts whatever the screen reader is saying to do it.
 */
export const AuthBanner = ({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TONE;
  title: string;
  children?: React.ReactNode;
}) => (
  <div
    className={cn(
      "mb-4 flex flex-col gap-1 rounded-control border border-chassis-raised border-l-2 bg-chassis-deep/60 px-2.75 py-2.25",
      TONE[tone],
    )}
    role="status"
  >
    <span className="text-label font-medium text-chassis-text-bright">{title}</span>
    {children ? <span className="text-row/hint text-chassis-text-muted">{children}</span> : null}
  </div>
);
