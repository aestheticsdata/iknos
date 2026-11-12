import { hostname } from "node:os";
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

  it("reads a blank Spira token as not configured, and defaults the URL (IKN-96)", () => {
    expect(parseEnv({ ...full, IKNOS_SPIRA_TOKEN: "" }).spiraToken).toBeNull();
    expect(parseEnv(full).spiraUrl).toBe("https://spira.1991computer.com");
    expect(parseEnv({ ...full, IKNOS_SPIRA_URL: "https://s.test/", IKNOS_SPIRA_TOKEN: "t" })).toMatchObject({
      spiraUrl: "https://s.test",
      spiraToken: "t",
    });
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

  it("scrapes every 30 s unless told otherwise, in milliseconds (IKN-63)", () => {
    expect(parseEnv(full).scrapeIntervalMs).toBe(30_000);
    expect(parseEnv({ ...full, IKNOS_SCRAPE_INTERVAL_SECONDS: "60" }).scrapeIntervalMs).toBe(60_000);
  });

  it("keeps rollups 90 days unless told otherwise (IKN-20)", () => {
    expect(parseEnv(full).rollupRetentionDays).toBe(90);
    expect(parseEnv({ ...full, IKNOS_ROLLUP_RETENTION_DAYS: "365" }).rollupRetentionDays).toBe(365);
  });

  it("refuses a scrape interval past the charts' one-minute grid, or absurdly short", () => {
    expect(() => parseEnv({ ...full, IKNOS_SCRAPE_INTERVAL_SECONDS: "90" })).toThrow(/IKNOS_SCRAPE_INTERVAL_SECONDS/);
    expect(() => parseEnv({ ...full, IKNOS_SCRAPE_INTERVAL_SECONDS: "1" })).toThrow(/IKNOS_SCRAPE_INTERVAL_SECONDS/);
  });

  it("names the host after IKNOS_HOST_LABEL, else after the machine itself (IKN-65)", () => {
    expect(parseEnv({ ...full, IKNOS_HOST_LABEL: "web01" }).hostLabel).toBe("web01");
    expect(parseEnv(full).hostLabel).toBe(hostname());
    // Blank is a slip in a config file, not a request for a nameless badge.
    expect(parseEnv({ ...full, IKNOS_HOST_LABEL: "  " }).hostLabel).toBe(hostname());
  });

  it("reads nginx's shared access log where ks-b keeps it, and none when set blank (IKN-84)", () => {
    expect(parseEnv(full).nginxSharedLog).toBe("/var/log/nginx/access.log");
    expect(parseEnv({ ...full, IKNOS_NGINX_SHARED_LOG: "/tmp/a.log" }).nginxSharedLog).toBe("/tmp/a.log");
    expect(parseEnv({ ...full, IKNOS_NGINX_SHARED_LOG: "" }).nginxSharedLog).toBeNull();
  });

  it("caps OTLP requests at 120 a minute per token and 240 per address unless told otherwise (IKN-87)", () => {
    expect(parseEnv(full).otlpTokenRatePerMinute).toBe(120);
    expect(parseEnv(full).otlpIpRatePerMinute).toBe(240);
    expect(parseEnv({ ...full, IKNOS_OTLP_TOKEN_RATE_PER_MINUTE: "30" }).otlpTokenRatePerMinute).toBe(30);
    expect(parseEnv({ ...full, IKNOS_OTLP_IP_RATE_PER_MINUTE: "600" }).otlpIpRatePerMinute).toBe(600);
    // Zero would close the route while looking configured; that is what revoking a token is for.
    expect(() => parseEnv({ ...full, IKNOS_OTLP_TOKEN_RATE_PER_MINUTE: "0" })).toThrow(
      /IKNOS_OTLP_TOKEN_RATE_PER_MINUTE/,
    );
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
