import type { Theme } from "@lib/interfaces/themeTypes";

/**
 * The work surface's theme. Dark is the default; light is the original palette (`tokens/light.css`).
 *
 * The theme lives on `<html data-theme>` and nowhere else: the CSS reads it there, and
 * `useTheme` reads it back from there, so the attribute and the switch cannot disagree. A reader
 * preference, so it is kept in `localStorage` like the time zone and never in the URL.
 */
export const THEME = { dark: "dark", light: "light" } as const;

export const DEFAULT_THEME: Theme = THEME.dark;

/** Namespaced like `iknos.tz`. */
export const THEME_STORAGE_KEY = "iknos.theme";

const THEME_EVENT = "iknos:theme";

export const isTheme = (value: unknown): value is Theme => Object.values(THEME).includes(value as Theme);

/** The theme painted right now. Only meaningful in the browser. */
export const currentTheme = () => {
  const painted = document.documentElement.dataset.theme;
  return isTheme(painted) ? painted : DEFAULT_THEME;
};

const paint = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(THEME_EVENT));
};

/**
 * Switches the theme, as a cross-fade where the browser can do one.
 *
 * Every colour on the work surface changes in one frame, which reads as a flash. A view transition
 * fades the old paint into the new one without each element needing a transition of its own. It
 * is skipped for a reader who asked for reduced motion and on engines without the API; both get
 * the new theme at once, correctly coloured.
 */
export const setTheme = (theme: Theme) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage throws in Safari's private mode. The choice still applies to this tab.
  }

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || !document.startViewTransition) {
    paint(theme);
    return;
  }
  document.startViewTransition(() => paint(theme));
};

export const subscribeTheme = (onChange: () => void) => {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
};

/**
 * Runs in `<head>` before the first paint, so a reader on the light theme never sees a dark frame
 * first. Kept as a string because it has to execute before React does. It sets the attribute only
 * for a stored value it recognises; anything else leaves the default.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t===${JSON.stringify(THEME.light)}||t===${JSON.stringify(THEME.dark)})document.documentElement.dataset.theme=t}catch(e){}`;
