/**
 * The two surfaces, and the classes each one resolves to — §3.1 and §3.2.
 *
 * Every primitive that can appear on both takes a `surface` and looks its colours up here. That is
 * the whole point of two ramps: a state colour legible on `#10151C` is not legible on `#BFCDD4`,
 * so the component is told which ground it is standing on rather than guessing.
 *
 * **Written out, never interpolated.** `bg-${surface}-surface` produces a class Tailwind's scanner
 * cannot see, so it is never emitted and the element renders unstyled — the failure looks like a
 * broken component rather than a missing class. Full literals are the cost of that not happening.
 */

export type Surface = "chassis" | "work";

/** The four things a badge, dot or value can mean. `ok` is the accent — brand and health share a hue but not a token. */
export type Tone = "ok" | "warn" | "error" | "info" | "neutral";

export const SURFACE_BG: Record<Surface, string> = {
  chassis: "bg-chassis-surface",
  work: "bg-work-surface",
};

export const SURFACE_INSET_BG: Record<Surface, string> = {
  chassis: "bg-chassis-inset",
  work: "bg-work-inset",
};

export const SURFACE_BORDER: Record<Surface, string> = {
  chassis: "border-chassis-border",
  work: "border-work-border",
};

export const SURFACE_BORDER_STRONG: Record<Surface, string> = {
  chassis: "border-chassis-border-strong",
  work: "border-work-border-strong",
};

export const SURFACE_TEXT: Record<Surface, string> = {
  chassis: "text-chassis-text",
  work: "text-work-text",
};

export const SURFACE_TEXT_MUTED: Record<Surface, string> = {
  chassis: "text-chassis-text-muted",
  work: "text-work-text-muted",
};

export const SURFACE_TEXT_DIM: Record<Surface, string> = {
  chassis: "text-chassis-text-dim",
  work: "text-work-text-dim",
};

/** Tone → text colour, per surface. Both halves clear AA as text; `pnpm run contrast` enforces it. */
export const TONE_TEXT: Record<Surface, Record<Tone, string>> = {
  chassis: {
    ok: "text-chassis-accent",
    warn: "text-chassis-warn",
    error: "text-chassis-error",
    info: "text-chassis-info",
    neutral: "text-chassis-text-muted",
  },
  work: {
    ok: "text-work-accent",
    warn: "text-work-warn",
    error: "text-work-error",
    info: "text-work-info",
    neutral: "text-work-text-muted",
  },
};

/** Tone → fill, for dots and the badge's left rule. Fills are not text and are not held to 4.5:1. */
export const TONE_FILL: Record<Surface, Record<Tone, string>> = {
  chassis: {
    ok: "bg-chassis-accent",
    warn: "bg-chassis-warn",
    error: "bg-chassis-error",
    info: "bg-chassis-info",
    neutral: "bg-chassis-text-dim",
  },
  work: {
    ok: "bg-work-accent",
    warn: "bg-work-warn",
    error: "bg-work-error",
    info: "bg-work-info",
    neutral: "bg-work-text-dim",
  },
};

/**
 * The scrollbar, per surface — `styles/utilities.css`.
 *
 * A scroller is told which ground it is on for the same reason a badge is: the thumb is the
 * surface's own border ink, and the dark ramp's on a light card is a slate bar across a pale
 * panel. Add `overflow-*` yourself — this is the ink and the geometry, not the decision to scroll.
 */
export const SURFACE_SCROLL: Record<Surface, string> = {
  chassis: "ik-scroll",
  work: "ik-scroll-work",
};

/** The same bar for a box that only moves sideways — it keeps vertical scroll chaining on. */
export const SURFACE_SCROLL_X: Record<Surface, string> = {
  chassis: "ik-scroll-x",
  work: "ik-scroll-work-x",
};
