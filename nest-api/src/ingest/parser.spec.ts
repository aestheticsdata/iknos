import { INGEST_SKIP_MARKER } from "@common/logger";
import { describe, expect, it } from "vitest";
import { parse } from "./parser";

const out = (line: string) => {
  const r = parse(line, "pfa-api", "out");
  if (!r) throw new Error("expected a record");
  return r;
};

describe("parse", () => {
  it("reads ECS with dotted keys", () => {
    const r = out(
      '{"@timestamp":"2026-08-09T10:11:12.345Z","log.level":"error","message":"boom",' +
        '"trace.id":"abc","http.request.method":"GET","url.path":"/api/users",' +
        '"http.response.status_code":500,"client.ip":"1.2.3.4"}',
    );

    expect(r.levelName).toBe("error");
    expect(r.level).toBe(50);
    expect(r.message).toBe("boom");
    expect(r.traceId).toBe("abc");
    expect(r.httpMethod).toBe("GET");
    expect(r.route).toBe("/api/users");
    expect(r.statusCode).toBe(500);
    expect(r.clientIp).toBe("1.2.3.4");
    expect(r.ts.toISOString()).toBe("2026-08-09T10:11:12.345Z");
  });

  it("reads ECS with nested keys", () => {
    // The ECS spec allows both shapes and loggers differ. Accept both.
    const r = out(
      '{"@timestamp":"2026-08-09T10:11:12.345Z","log":{"level":"warn","logger":"http"},' +
        '"message":"slow","trace":{"id":"xyz"}}',
    );

    expect(r.levelName).toBe("warn");
    expect(r.level).toBe(40);
    expect(r.logger).toBe("http");
    expect(r.traceId).toBe("xyz");
  });

  it("keeps unknown fields in attrs and does not duplicate promoted ones", () => {
    const r = out('{"@timestamp":"2026-08-09T10:11:12.345Z","log.level":"info","message":"m","orderId":42}');
    expect(r.attrs?.orderId).toBe(42);
    expect(r.attrs?.message).toBeUndefined();
  });

  it("falls back for JSON without ECS", () => {
    const r = out('{"msg":"hello","pid":17}');
    expect(r.message).toBe("hello");
    expect(r.attrs?.pid).toBe(17);
  });

  it("treats plain text as a message", () => {
    const r = out("Server started on port 3000");
    expect(r.message).toBe("Server started on port 3000");
    expect(r.levelName).toBe("info");
  });

  it("infers error level from the stream", () => {
    expect(parse("something failed", "pfa-api", "err")?.levelName).toBe("error");
  });

  it("refines level from a common prefix", () => {
    expect(out("WARN  deprecation notice").levelName).toBe("warn");
  });

  it("strips ANSI escapes", () => {
    const r = out("\u001b[32m[Nest]\u001b[0m started");
    expect(r.message).not.toContain("\u001b");
    expect(r.message).toBe("[Nest] started");
  });

  it("stores truncated JSON as plain text rather than throwing", () => {
    const r = out('{"@timestamp":"2026-08-09T10:11:12.345Z","mess');
    expect(r.message.startsWith("{")).toBe(true);
    expect(r.levelName).toBe("info");
  });

  it("skips the self-error marker", () => {
    // Otherwise a database outage becomes an infinite loop.
    expect(parse(`${INGEST_SKIP_MARKER} database unreachable`, "iknos", "err")).toBeNull();
  });

  it("falls back to now when the timestamp is unparseable", () => {
    const before = Date.now();
    const r = out('{"@timestamp":"not-a-date","log.level":"info","message":"m"}');
    expect(r.ts.getTime()).toBeGreaterThanOrEqual(before - 2000);
  });

  it("skips a blank line", () => {
    expect(parse("   ", "pfa-api", "out")).toBeNull();
  });

  describe("health-probe noise", () => {
    it("drops a plaintext Nest route line for a health path", () => {
      // trekker/spira shape: ANSI already stripped by parse, loopback client, node UA.
      expect(parse("[Route] GET   /api/health \u2192 Nest [127.0.0.1] node", "trekker-api", "out")).toBeNull();
    });

    it("drops Zeus's own probe access line", () => {
      expect(
        parse("[2026-08-20 20:00:04] [Zeus] GET /api/health \u2014 127.0.0.1 \u2014 node", "zeus-nest-api", "out"),
      ).toBeNull();
    });

    it("drops a successful ECS health request", () => {
      const line =
        '{"@timestamp":"2026-08-20T10:00:00.000Z","log.level":"info","message":"request completed",' +
        '"http.request.method":"GET","url.path":"/health","http.response.status_code":200}';
      expect(parse(line, "iknos-api", "out")).toBeNull();
    });

    it("keeps a failing ECS health request", () => {
      const line =
        '{"@timestamp":"2026-08-20T10:00:00.000Z","log.level":"info","message":"request errored",' +
        '"http.request.method":"GET","url.path":"/health","http.response.status_code":503}';
      expect(out(line).statusCode).toBe(503);
    });

    it("keeps a warn-or-worse line even on a health path", () => {
      expect(out("ERROR health check timed out after GET /api/health").levelName).toBe("error");
    });

    it("keeps prose that merely mentions a longer path", () => {
      // \b must not treat "healthcheck" or "/health/deep" prose as the probe route itself.
      expect(out("scheduling GET /api/healthcheck-partner sync").message).toContain("healthcheck-partner");
    });

    it("keeps ordinary requests to other routes", () => {
      const line =
        '{"@timestamp":"2026-08-20T10:00:00.000Z","log.level":"info","message":"request completed",' +
        '"http.request.method":"GET","url.path":"/api/users","http.response.status_code":200}';
      expect(out(line).route).toBe("/api/users");
    });
  });
});
