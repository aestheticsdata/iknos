import type { THEME } from "@lib/theme";

/** Which theme the work surface is painted in. */
export type Theme = (typeof THEME)[keyof typeof THEME];
