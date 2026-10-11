import { cn } from "@lib/utils";
import { createContext, use, useId } from "react";

/**
 * What a field hands the input inside it: the id its `<label>` points at, and the id of the error
 * line when there is an error to describe it with.
 */
type FieldWiring = {
  id: string;
  errorId: string | undefined;
};

/*
 * Context rather than an `id` prop at eleven call sites (IKN-41). `register()` supplies `name`,
 * `onChange`, `onBlur` and `ref` and never an `id`, which is how every auth field shipped with a
 * label tied to nothing — a screen reader announced "edit text, blank" for the email and the
 * password alike. `ui/Field` closes the same gap with `useId`; here the label and the input are
 * two components, so the id travels between them instead of being asked of every caller.
 */
const FieldContext = createContext<FieldWiring | null>(null);

type AuthFieldProps = {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  // The spread is what lets a `data-testid` and a `data-field` companion reach the wrapper — see `Card`.
} & React.ComponentPropsWithRef<"div">;

/**
 * A labelled field on the chassis: kicker on the left, an optional rule and an optional action
 * (the reveal toggle) on the right, the control, then the error.
 *
 * The error sits *under* the field and the field keeps its size when it appears — `min-h` on the
 * message rather than conditional rendering. A form that grows by 14px every time a validation
 * fires walks the submit button out from under the cursor mid-click.
 */
export const AuthField = ({ label, hint, action, error, children, ...rest }: AuthFieldProps) => {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <FieldContext value={{ id, errorId: error ? errorId : undefined }}>
      <div
        className="flex flex-col gap-1.25"
        {...rest}
      >
        <div className="flex items-center gap-2">
          {/* A real `<label>`: announced with the input, and a click on it focuses the input. */}
          <label
            htmlFor={id}
            className="flex-1 text-kicker tracking-kicker text-chassis-text-dim"
          >
            {label}
          </label>
          {hint ? <span className="text-kicker text-chassis-text-dim">{hint}</span> : null}
          {action}
        </div>
        {children}
        {/* Named because its text is the validation state — empty, then `required`, then empty again —
            so a text locator has nothing stable to hold. Scope it by the wrapper's `data-field`. */}
        <span
          id={errorId}
          className="min-h-[13px] text-micro text-chassis-error"
          data-testid="auth-field-error"
        >
          {error ?? ""}
        </span>
      </div>
    </FieldContext>
  );
};

/**
 * The input itself. `aria-invalid` drives the border colour, so the styling and what a screen
 * reader is told can never disagree — there is no way to make one red without setting the other.
 *
 * Its `id` and `aria-describedby` come from the `AuthField` around it (IKN-41); a caller's own
 * values win, for the input that ever needs one.
 */
export const AuthInput = ({ className, ...props }: React.ComponentPropsWithRef<"input">) => {
  const field = use(FieldContext);

  return (
    <input
      id={field?.id}
      aria-describedby={field?.errorId}
      className={cn(
        "h-8 rounded-control border border-chassis-border-strong bg-chassis-inset px-2.5",
        "text-ui text-chassis-text placeholder:text-chassis-border-focus",
        "transition-[border-color] duration-150 ease-out hover:border-chassis-border-focus focus:border-chassis-border-focus focus:outline-none",
        "aria-[invalid=true]:border-chassis-error",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
};
