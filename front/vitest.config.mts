import { defineConfig } from "vitest/config";

/**
 * Unit tests only, and deliberately narrow.
 *
 * `front/` had no runner at all before IKN-38. This one exists for `src/lib/zone.ts` — pure
 * functions whose whole job is to be right about an offset that changes twice a year, which is
 * exactly the kind of thing nobody notices is broken until October.
 *
 * Still **no jsdom**, and that has not softened: nothing here mounts a component, fires an event or
 * waits for an effect. Since IKN-13 a few specs render markup to a string with
 * `renderToStaticMarkup`, which needs no DOM and no environment — they check *what* is rendered,
 * because half of that ticket's Done list is a rule about exactly that. Layout, pixels and
 * interaction still need a browser, and they always will.
 *
 * `TZ` is pinned so the suite says the same thing on the laptop, on ks-b and in any CI: every
 * assertion names its zone explicitly, and a machine-dependent default would make the one
 * function that reads the runtime zone untestable rather than untested.
 */
export default defineConfig({
  /**
   * The `paths` aliases from `tsconfig.json`, which Next resolves for the app and vitest does not.
   *
   * Until IKN-13 every tested module happened to import nothing at runtime but relative paths — the
   * one `@lib/*` import in the set is `import type`, which is erased — so the gap was invisible.
   * The first `import { … } from "@lib/…"` in a tested file fails to resolve, and the failure reads
   * as a missing package rather than as a missing alias.
   *
   * Native to the bundler; `vite-tsconfig-paths` is deprecated in its favour. Nothing guards it
   * separately — `serviceFormat.spec.ts` and `logsHref.spec.ts` both import through an alias, so
   * the day this stops being honoured the run fails rather than quietly resolving nothing.
   */
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
    env: { TZ: "UTC" },
  },
});
