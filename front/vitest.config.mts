import { defineConfig } from "vitest/config";

/**
 * Unit tests only, and deliberately narrow.
 *
 * `front/` had no runner at all before IKN-38. This one exists for `src/lib/zone.ts` — pure
 * functions whose whole job is to be right about an offset that changes twice a year, which is
 * exactly the kind of thing nobody notices is broken until October. Components are not covered
 * here and pretending otherwise with a jsdom environment would only invite it.
 *
 * `TZ` is pinned so the suite says the same thing on the laptop, on ks-b and in any CI: every
 * assertion names its zone explicitly, and a machine-dependent default would make the one
 * function that reads the runtime zone untestable rather than untested.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
    env: { TZ: "UTC" },
  },
});
