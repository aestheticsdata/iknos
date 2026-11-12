"use client";

import { currentTheme, subscribeTheme } from "@lib/theme";
import { useSyncExternalStore } from "react";

/**
 * The theme in force, or `null` on the server and during hydration.
 *
 * The server cannot know it (it is in `localStorage`), so anything that *names* the theme waits
 * for a non-null value, as the zone toggle does for the zone.
 */
export const useTheme = () => useSyncExternalStore(subscribeTheme, currentTheme, () => null);
