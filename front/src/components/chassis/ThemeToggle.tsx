"use client";

import { Tooltip } from "@components/ui/Tooltip";
import { setTheme, THEME } from "@lib/theme";
import { useTheme } from "@lib/useTheme";
import { cn } from "@lib/utils";
import { THEME_TEXT } from "@text/theme";

/**
 * The theme switch — the half-filled disc and the name of the theme in force, as the AI-traces
 * mockups draw it in the top bar.
 *
 * One button rather than a two-half control like the zone toggle: the screen itself says which
 * theme is on, so the control only has to offer the other one.
 *
 * Invisible until the theme is known, and it holds its width while it waits, so the cluster it
 * sits in does not shift when the label lands. `min-w-14` fits both names.
 */
export const ThemeToggle = () => {
  const theme = useTheme();
  const next = theme === THEME.light ? THEME.dark : THEME.light;

  return (
    <Tooltip
      mode="hover"
      content={theme ? THEME_TEXT.hint : null}
    >
      <button
        type="button"
        onClick={() => setTheme(next)}
        disabled={theme === null}
        aria-label={THEME_TEXT.switchTo(THEME_TEXT.name[next])}
        data-testid="theme-toggle"
        data-theme-in-force={theme ?? undefined}
        className={cn(
          "flex h-6 min-w-14 items-center justify-center gap-1.5 rounded-control px-1.5",
          "border border-chassis-border-strong text-kicker tracking-control text-chassis-text-muted",
          "transition-colors duration-150 ease-out hover:border-chassis-border-focus hover:text-chassis-text",
          theme === null && "invisible",
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="size-3 flex-none fill-none stroke-current"
          strokeWidth="1.5"
        >
          <circle
            cx="6"
            cy="6"
            r="4.3"
          />
          <path
            d="M6 1.7a4.3 4.3 0 0 0 0 8.6z"
            className="fill-current"
          />
        </svg>
        {theme ? THEME_TEXT.name[theme] : ""}
      </button>
    </Tooltip>
  );
};
