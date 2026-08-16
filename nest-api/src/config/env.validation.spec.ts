import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.validation";

const full = {
  DATABASE_URL: "mysql://x/y",
  REDIS_URL: "redis://x",
  IKNOS_PORT: "4310",
  IKNOS_LOG_LEVEL: "info",
  IKNOS_COOKIE_SECRET: "k".repeat(64),
  IKNOS_RETENTION_DAYS: "14",
  IKNOS_PM2_LOG_GLOB: "/tmp/*.log",
};

// Taking a source object rather than reading process.env keeps these tests free of global
// state, and therefore order-independent.
describe("parseEnv", () => {
  it("loads a complete environment", () => {
    const cfg = parseEnv(full);
    expect(cfg.port).toBe(4310);
    expect(cfg.retentionDays).toBe(14);
  });

  it("names the missing variable", () => {
    const { REDIS_URL, ...rest } = full;
    expect(() => parseEnv(rest)).toThrow(/REDIS_URL/);
  });

  it("rejects a short cookie secret", () => {
    expect(() => parseEnv({ ...full, IKNOS_COOKIE_SECRET: "short" })).toThrow(/IKNOS_COOKIE_SECRET/);
  });

  it("rejects a non-numeric port", () => {
    expect(() => parseEnv({ ...full, IKNOS_PORT: "http" })).toThrow(/IKNOS_PORT/);
  });

  it("rejects a zero retention window", () => {
    expect(() => parseEnv({ ...full, IKNOS_RETENTION_DAYS: "0" })).toThrow(/IKNOS_RETENTION_DAYS/);
  });

  it("rejects an unknown log level", () => {
    expect(() => parseEnv({ ...full, IKNOS_LOG_LEVEL: "verbose" })).toThrow(/IKNOS_LOG_LEVEL/);
  });

  it("reports every offending variable at once, not just the first", () => {
    const broken = { ...full, IKNOS_PORT: "http", IKNOS_RETENTION_DAYS: "0" };
    // A boot that names one problem per attempt costs a restart cycle per variable.
    expect(() => parseEnv(broken)).toThrow(/IKNOS_PORT[\s\S]*IKNOS_RETENTION_DAYS/);
  });
});
