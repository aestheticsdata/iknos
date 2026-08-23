import { describe, expect, it } from "vitest";
import { logsHref } from "./logsHref";

/**
 * The link into the log view (IKN-13).
 *
 * A guard rather than TDD output. The failure this exists to prevent is silent: `logQuery.ts` has
 * four functions that look like they build this href and are API paths emitting absolute `from`/`to`
 * — and the log view reads that pair back as a *pinned* window that overrides the range buttons. A
 * tile linked through one of those would land the reader on the right interval with the range
 * selector quietly overruled, which nobody would notice until they pressed `24h` and nothing moved.
 */
describe("logsHref", () => {
  it("carries the range across rather than freezing it into a pair of instants", () => {
    expect(logsHref({ range: "1h", values: { service: "pfa-nest-api" } })).toBe("/logs?service=pfa-nest-api&range=1h");
  });

  it("sets the filters it is given and nothing else", () => {
    expect(logsHref({ range: "24h", values: { service: "pfa-nest-api", level: "error" } })).toBe(
      "/logs?service=pfa-nest-api&level=error&range=24h",
    );
  });

  it("drops a filter with no value instead of sending an empty one", () => {
    // The API treats an absent parameter and an empty one the same way, and relying on that is
    // asking a remote coincidence to hold.
    expect(logsHref({ range: "15m", values: { service: null, level: undefined, route: "" } })).toBe("/logs?range=15m");
  });

  it("never emits `off`, which is what makes every filter it names arrive switched on", () => {
    const href = logsHref({ range: "1h", values: { level: "error" } });

    expect(href).not.toContain("off=");
  });

  it("pins the window when the caller is pointing at a moment rather than a range", () => {
    const bounds = { from: "2026-08-23T11:58:00.000Z", to: "2026-08-23T12:02:00.000Z" };

    const href = logsHref({ range: "1h", values: { service: "pfa-nest-api" }, bounds });

    expect(href).toContain("from=2026-08-23T11%3A58%3A00.000Z");
    expect(href).toContain("to=2026-08-23T12%3A02%3A00.000Z");
    // And the range travels with it. The two are not in conflict — the log view reads the pair as a
    // pinned window that overrides the range buttons — but the moment the reader unpins it, `range`
    // is what the window falls back to. Sending only the bounds would drop somebody who arrived
    // from a one-hour screen onto the default seven days.
    expect(href).toContain("range=1h");
  });
});
