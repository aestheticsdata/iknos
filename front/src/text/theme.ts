import { THEME } from "@lib/theme";

import type { Theme } from "@lib/interfaces/themeTypes";

/** The top bar's theme switch. */
export const THEME_TEXT = {
  name: { [THEME.dark]: "dark", [THEME.light]: "light" } satisfies Record<Theme, string>,
  switchTo: (name: string) => `Switch to the ${name} theme`,
  hint: "The work surface's theme. The bars stay dark in both.",
};
