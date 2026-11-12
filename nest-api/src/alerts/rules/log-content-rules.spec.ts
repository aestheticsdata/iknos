import { describe, expect, it } from "vitest";
import { reconcile } from "../reconcile";
import { ACTION_FAILURES_MIN, BROWSER_ERRORS_SPIKE } from "../thresholds";
import { actionFailures, browserErrors } from "./log-content-rules";

import type { PrismaService } from "@db/prisma.service";
import type { OpenAlert } from "../reconcile";
import type { Rule, RuleContext } from "../rule";

/** The two log-content rules against the reconciler: forced conditions open, a clean window resolves. */

const T0 = Date.UTC(2026, 10, 12, 16, 0, 0);
const firing: OpenAlert = { id: 1, state: "firing", pendingSince: null, severity: "warning" };

/** `n` lines counted for "svc" in the window; `null` is none at all (absent from the result). */
async function observe(rule: Rule, n: number | null) {
  const rows = n === null ? [] : [{ service: "svc", n: BigInt(n) }];
  const queries: string[] = [];
  const prisma = {
    $queryRaw: async (sql: TemplateStringsArray) => {
      queries.push(sql.join("?"));
      return rows;
    },
  } as unknown as PrismaService;
  const ctx: RuleContext = {
    prisma,
    now: T0,
    targets: [{ name: "svc", pm2Name: "svc", hasMetrics: false, hasHealth: false }],
    signals: async () => null,
  };
  const [observation] = await rule.evaluate(ctx);
  return { observation, sql: queries[0] ?? "" };
}

describe("browser_errors", () => {
  it("opens on a spike of relayed browser errors", async () => {
    const { observation, sql } = await observe(browserErrors, BROWSER_ERRORS_SPIKE);
    expect(observation).toEqual({ service: "svc", value: BROWSER_ERRORS_SPIKE, breached: true });
    expect(reconcile(browserErrors, observation, null, T0).kind).toBe("open");
    // Read in both ECS shapes, and bounded by the window.
    expect(sql).toContain(`'$."event.dataset"'`);
    expect(sql).toContain("'$.event.dataset'");
    expect(sql).toContain("ts >= ?");
  });

  it("stays quiet below the spike", async () => {
    const { observation } = await observe(browserErrors, BROWSER_ERRORS_SPIKE - 1);
    expect(reconcile(browserErrors, observation, null, T0).kind).toBe("none");
  });

  it("resolves once the window holds none", async () => {
    const { observation } = await observe(browserErrors, null);
    expect(observation).toEqual({ service: "svc", value: 0, breached: false });
    expect(reconcile(browserErrors, observation, firing, T0).kind).toBe("resolve");
  });
});

describe("action_failures", () => {
  it("opens, critical, on the first failed action", async () => {
    const { observation, sql } = await observe(actionFailures, ACTION_FAILURES_MIN);
    expect(observation.breached).toBe(true);
    expect(actionFailures.severity).toBe("critical");
    expect(reconcile(actionFailures, observation, null, T0).kind).toBe("open");
    expect(sql).toContain("= 'failure'");
    expect(sql).toContain("event.action");
  });

  it("resolves once the window holds none", async () => {
    const { observation } = await observe(actionFailures, null);
    expect(reconcile(actionFailures, observation, { ...firing, severity: "critical" }, T0).kind).toBe("resolve");
  });
});
