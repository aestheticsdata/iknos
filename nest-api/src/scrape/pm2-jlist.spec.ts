import { describe, expect, it } from "vitest";
import { parseJlist } from "./pm2-jlist";

/**
 * `pm2 jlist` output → one reading per process (IKN-8). The subprocess is the one place a shell
 * out is tolerated, so everything that can be tested without it — the parsing — is pure. pm2's
 * JSON is large and undocumented; only the fields the service header chips need are read, and
 * every one of them is allowed to be missing without sinking the row.
 */
describe("parseJlist", () => {
  const entry = {
    pid: 4321,
    name: "pfa-nest-api",
    pm_id: 3,
    monit: { memory: 123456789, cpu: 1.5 },
    pm2_env: {
      status: "online",
      restart_time: 3,
      pm_uptime: 1787000000000,
      node_version: "22.4.1",
    },
  };

  it("maps a pm2 process entry onto a reading", () => {
    expect(parseJlist(JSON.stringify([entry]))).toEqual([
      {
        pm2Name: "pfa-nest-api",
        pm2Id: 3,
        status: "online",
        restarts: 3,
        cpuPct: 1.5,
        memBytes: 123456789,
        startedAt: new Date(1787000000000),
        nodeVersion: "22.4.1",
      },
    ]);
  });

  it("keeps a stopped process, with what pm2 still knows about it", () => {
    const stopped = { name: "zeus-front", pm_id: 7, monit: null, pm2_env: { status: "stopped", restart_time: 12 } };

    expect(parseJlist(JSON.stringify([stopped]))).toEqual([
      {
        pm2Name: "zeus-front",
        pm2Id: 7,
        status: "stopped",
        restarts: 12,
        cpuPct: null,
        memBytes: null,
        startedAt: null,
        nodeVersion: null,
      },
    ]);
  });

  it("skips entries without a name rather than inventing one", () => {
    expect(parseJlist(JSON.stringify([{ pm_id: 1 }, entry]))).toHaveLength(1);
  });

  it("returns null for anything that is not a JSON array — a data absence, not an exception", () => {
    expect(parseJlist("pm2: command not found")).toBeNull();
    expect(parseJlist('{"not":"an array"}')).toBeNull();
    expect(parseJlist("")).toBeNull();
  });
});
