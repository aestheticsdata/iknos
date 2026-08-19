import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

import type { ClassValue } from "clsx";

/**
 * `tailwind-merge`, taught this project's scales.
 *
 * **Without this it silently deletes font sizes.** tailwind-merge decides which classes conflict
 * from a table of Tailwind's *default* scales, and Iknos replaced those wholesale: the type steps
 * are `kicker … display`, not `xs … 9xl`. A name it does not recognise falls through to the
 * catch-all colour matcher, so `text-row` and `text-chassis-text` both land in `text-color` — one
 * group, last one wins — and `cn("text-row", "text-chassis-text")` returns just the colour. The
 * text renders at the inherited size, which is 16px against a design whose densest step is 10.5px.
 *
 * Nothing warns about this. It is a silent wrong-size, and it was found by a reviewer noticing
 * five instances in one file rather than by anything failing — which is why the fix belongs here,
 * in the one function every component composes classes through, and not in the five call sites.
 *
 * The three lists below must stay equal to `styles/tokens/typography.css`. A token added there and
 * not here is a token that starts disappearing.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["kicker", "micro", "row", "label", "dense", "ui", "signal", "title", "display"] }],
      tracking: [{ tracking: ["kicker", "chrome", "control", "title", "display"] }],
      leading: [{ leading: ["hint", "prose", "display"] }],
    },
  },
});

/** Conditional classes, with later Tailwind utilities beating earlier ones instead of both landing. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
