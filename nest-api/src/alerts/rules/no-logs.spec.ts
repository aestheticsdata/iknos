import { describe, expect, it } from "vitest";
import { reconcile } from "../reconcile";
import { noLogs } from "./no-logs";

import type { PrismaService } from "@db/prisma.service";
import type { OpenAlert } from "../reconcile";
import type { RuleContext } from "../rule";

/**
 * `no_logs` against the reconciler (IKN-81), because the bug it guards against lived between the two: a
 * service that came back quietly read as `null`, the reconciler left the alert alone, and
 * `folio-front` stayed firing for days while logging.
 */

type Counts = { busy: number; quiet: number };

const T0 = Date.UTC(2026, 9, 22, 18, 0, 0);

const firing: OpenAlert = { id: 1, state: "firing", pendingSince: null, severity: "warning" };

async function observe(counts: Counts) {
  const prisma = { $queryRaw: async () => [{ service: "svc", ...counts }] } as unknown as PrismaService;
  const ctx: RuleContext = {
    prisma,
    now: T0,
    targets: [{ name: "svc", pm2Name: "svc", hasMetrics: false, hasHealth: false }],
    signals: async () => null,
  };
  const [observation] = await noLogs.evaluate(ctx);
  return observation;
}

describe("no_logs", () => {
  it("fires on a busy service that has gone silent", async () => {
    const observation = await observe({ busy: 62, quiet: 0 });
    expect(observation).toEqual({ service: "svc", value: 62, breached: true });
    expect(reconcile(noLogs, observation, null, T0).kind).toBe("open");
  });

  it("does not open on an idle service", async () => {
    const observation = await observe({ busy: 3, quiet: 0 });
    expect(reconcile(noLogs, observation, null, T0).kind).toBe("none");
  });

  it("keeps the alert open once the busy hour has slid out of the window", async () => {
    const observation = await observe({ busy: 0, quiet: 0 });
    expect(reconcile(noLogs, observation, firing, T0).kind).toBe("none");
  });

  it("resolves as soon as the service logs again, however quietly", async () => {
    const observation = await observe({ busy: 0, quiet: 1 });
    expect(observation).toEqual({ service: "svc", value: 0, breached: false });
    expect(reconcile(noLogs, observation, firing, T0).kind).toBe("resolve");
  });

  it("resolves a busy service that is still talking", async () => {
    const observation = await observe({ busy: 120, quiet: 30 });
    expect(reconcile(noLogs, observation, firing, T0).kind).toBe("resolve");
  });
});
