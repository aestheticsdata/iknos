import { cn } from "@lib/utils";

/**
 * The chassis button, in the two weights the auth screens use.
 *
 * `solid` is the one thing a screen is for — sign in, register, reset. `quiet` is the way out of
 * it, and is a button rather than a link only when it does not navigate.
 *
 * A disabled solid button keeps its shape and loses its colour, which is what the sealed register
 * screen wants: the mockup leaves a dead REGISTER button in place rather than removing it, so the
 * page reads as *closed* rather than as *broken*.
 */
export const Button = ({
  variant = "solid",
  className,
  ...props
}: React.ComponentPropsWithRef<"button"> & { variant?: "solid" | "quiet" }) => (
  <button
    className={cn(
      "flex h-8 items-center rounded-control px-4 text-dense font-medium tracking-control",
      // `color` belongs in the list: the quiet variant recolours its ink on hover and both
      // variants dim it when disabled, so without it the border travels and the letters jump.
      "transition-[filter,background-color,color] hover:brightness-110",
      variant === "solid" && "bg-chassis-accent text-chassis-deep",
      variant === "quiet" && "border border-chassis-border-strong text-chassis-text-muted hover:text-chassis-text",
      "disabled:cursor-not-allowed disabled:bg-chassis-border-strong disabled:text-chassis-text-muted disabled:hover:brightness-100",
      className,
    )}
    type="button"
    {...props}
  />
);
