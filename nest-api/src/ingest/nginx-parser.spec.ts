import { describe, expect, it } from "vitest";
import { parseCombined } from "./nginx-parser";

/**
 * Every line here is nginx's `combined` format, which is what every vhost on ks-b is configured
 * with — see `deploy/nginx/iknos.conf:55`.
 */
const LINE =
  '203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "GET /shots/iknos/logs-960.avif HTTP/2.0" 200 31245 "https://1991computer.com/" "Mozilla/5.0 (Macintosh)"';

describe("parseCombined", () => {
  it("maps a combined line onto the promoted columns", () => {
    const r = parseCombined(LINE, "landing-page");

    expect(r).not.toBeNull();
    expect(r?.service).toBe("landing-page");
    expect(r?.clientIp).toBe("203.0.113.5");
    expect(r?.httpMethod).toBe("GET");
    expect(r?.route).toBe("/shots/iknos/logs-960.avif");
    expect(r?.statusCode).toBe(200);
    expect(r?.logger).toBe("nginx.access");
    expect(r?.message).toBe("GET /shots/iknos/logs-960.avif 200");
    // combined carries no $request_time, so this column stays empty for nginx lines.
    expect(r?.durationMs).toBeNull();
    // and no $host — which is the whole reason each vhost writes its own file.
    expect(r?.hostname).toBeNull();
  });

  it("reads the offset in the line rather than assuming the server's", () => {
    // 14:02:31 at +0200 is 12:02:31 UTC. A parser that ignored the offset would be two hours out,
    // and every range query against these rows would be quietly wrong.
    const r = parseCombined(LINE, "landing-page");
    expect(r?.ts.toISOString()).toBe("2026-09-16T12:02:31.000Z");
  });

  it("derives the level from the status code", () => {
    const at = (status: number) => {
      const line = LINE.replace('" 200 ', `" ${status} `);
      return parseCombined(line, "landing-page");
    };

    // The bands, tested at both edges of each — this is what makes the existing level filter and
    // the `level >= 50` searches work on nginx lines without a second control.
    expect(at(199)?.levelName).toBe("info");
    expect(at(200)?.levelName).toBe("info");
    expect(at(399)?.levelName).toBe("info");
    expect(at(400)?.levelName).toBe("warn");
    expect(at(499)?.levelName).toBe("warn");
    expect(at(500)?.levelName).toBe("error");
    expect(at(500)?.level).toBe(50);
  });

  it("strips the query string off route and keeps it in attrs", () => {
    const line = LINE.replace("/shots/iknos/logs-960.avif", "/?p=iknos&tab=demo");
    const r = parseCombined(line, "landing-page");

    // `route` is VarChar(255) and carries @@index([route, ts]); query strings in it would make
    // that index cardinality noise.
    expect(r?.route).toBe("/");
    expect(r?.attrs?.query).toBe("p=iknos&tab=demo");
  });

  it("keeps the referrer, agent, protocol and byte count in attrs", () => {
    const r = parseCombined(LINE, "landing-page");
    expect(r?.attrs).toEqual({
      referrer: "https://1991computer.com/",
      userAgent: "Mozilla/5.0 (Macintosh)",
      protocol: "HTTP/2.0",
      bytes: 31245,
    });
  });

  it("omits the fields nginx wrote as a dash", () => {
    const line = '203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "GET / HTTP/1.1" 200 0 "-" "-"';
    const r = parseCombined(line, "landing-page");

    // A dash is nginx saying "absent". Storing the string "-" would make every filter on referrer
    // match a value that means nothing.
    expect(r?.attrs).toEqual({ protocol: "HTTP/1.1", bytes: 0 });
    expect(r?.userId).toBeNull();
  });

  it("reads $remote_user when there is one", () => {
    const line = LINE.replace("- - [16/Sep", "- alice [16/Sep");
    expect(parseCombined(line, "landing-page")?.userId).toBe("alice");
  });

  it("handles IPv6 and IPv4-mapped IPv6 in remote_addr", () => {
    const v6 = LINE.replace("203.0.113.5", "2001:db8::8a2e:370:7334");
    expect(parseCombined(v6, "landing-page")?.clientIp).toBe("2001:db8::8a2e:370:7334");

    const mapped = LINE.replace("203.0.113.5", "::ffff:203.0.113.5");
    expect(parseCombined(mapped, "landing-page")?.clientIp).toBe("::ffff:203.0.113.5");
  });

  it("stores a line it cannot read rather than dropping it", () => {
    const r = parseCombined("this is not a combined line at all", "landing-page");

    // Same rule the ECS parser applies at parser.ts:106 — degraded beats dropped, and the raw
    // line is the whole evidence. A log_format changed on the box has to show as a rising
    // degraded count, not as silence.
    expect(r?.degraded).toBe(true);
    expect(r?.message).toBe("this is not a combined line at all");
    expect(r?.clientIp).toBeNull();
    expect(r?.levelName).toBe("info");
  });

  it("survives a request line that is not a request line", () => {
    // Scanners send exactly this sort of thing. It must parse as far as it can and never throw.
    const line = '203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "\\x16\\x03\\x01" 400 0 "-" "-"';
    const r = parseCombined(line, "landing-page");

    expect(r).not.toBeNull();
    expect(r?.statusCode).toBe(400);
    expect(r?.clientIp).toBe("203.0.113.5");
    expect(r?.route).toBeNull();
    expect(r?.httpMethod).toBeNull();
  });

  it("drops a blank line", () => {
    expect(parseCombined("", "landing-page")).toBeNull();
    expect(parseCombined("   \n", "landing-page")).toBeNull();
  });

  it("rejects a month name that is not one", () => {
    const line = LINE.replace("/Sep/", "/Foo/");
    // Not a crash, and not a silently wrong date either: it degrades.
    expect(parseCombined(line, "landing-page")?.degraded).toBe(true);
  });
});
