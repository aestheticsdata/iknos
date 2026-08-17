import { cn } from "@lib/utils";

/**
 * A labelled field on the chassis: kicker on the left, an optional rule and an optional action
 * (the reveal toggle) on the right, the control, then the error.
 *
 * The error sits *under* the field and the field keeps its size when it appears — `min-h` on the
 * message rather than conditional rendering. A form that grows by 14px every time a validation
 * fires walks the submit button out from under the cursor mid-click.
 */
export const AuthField = ({
  label,
  hint,
  action,
  error,
  children,
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-[5px]">
    <div className="flex items-center gap-2">
      <span className="flex-1 text-kicker tracking-kicker text-chassis-text-dim">{label}</span>
      {hint ? <span className="text-kicker text-chassis-text-dim">{hint}</span> : null}
      {action}
    </div>
    {children}
    <span className="min-h-[13px] text-micro text-chassis-error">{error ?? ""}</span>
  </div>
);

/**
 * The input itself. `aria-invalid` drives the border colour, so the styling and what a screen
 * reader is told can never disagree — there is no way to make one red without setting the other.
 */
export const AuthInput = ({ className, ...props }: React.ComponentPropsWithRef<"input">) => (
  <input
    className={cn(
      "h-8 rounded-control border border-chassis-border-strong bg-chassis-inset px-2.5",
      "text-ui text-chassis-text placeholder:text-chassis-border-focus",
      "hover:border-chassis-border-focus focus:border-chassis-border-focus focus:outline-none",
      "aria-[invalid=true]:border-chassis-error",
      "disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  />
);
