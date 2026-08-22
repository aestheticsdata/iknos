import { describe, expect, it } from "vitest";
import { parsePromLine } from "./prometheus-parser";

/**
 * The Prometheus text format, one line at a time (IKN-8). Line-at-a-time is the contract: the
 * scraper feeds this from a byte stream through a LineBuffer, never from a multi-megabyte
 * string split — the parser must therefore be complete per line and never throw, because one
 * malformed line from a misbehaving exporter must not cost the rest of the scrape.
 */
describe("parsePromLine", () => {
  it("parses a bare counter sample without labels", () => {
    expect(parsePromLine("process_cpu_seconds_total 0.308459")).toEqual({
      name: "process_cpu_seconds_total",
      labels: null,
      value: 0.308459,
    });
  });

  it("parses a labelled counter sample", () => {
    expect(parsePromLine('http_requests_total{method="GET",route="/api/dossiers/:id",status_code="200"} 41')).toEqual({
      name: "http_requests_total",
      labels: { method: "GET", route: "/api/dossiers/:id", status_code: "200" },
      value: 41,
    });
  });

  it("parses a gauge with a negative and a scientific value", () => {
    expect(parsePromLine("nodejs_external_memory_bytes -1.5e3")).toEqual({
      name: "nodejs_external_memory_bytes",
      labels: null,
      value: -1500,
    });
  });

  it("parses histogram bucket, sum and count lines, le kept as a plain label", () => {
    expect(parsePromLine('http_request_duration_seconds_bucket{le="0.25",method="GET"} 7')).toEqual({
      name: "http_request_duration_seconds_bucket",
      labels: { le: "0.25", method: "GET" },
      value: 7,
    });
    expect(parsePromLine('http_request_duration_seconds_bucket{le="+Inf",method="GET"} 9')).toEqual({
      name: "http_request_duration_seconds_bucket",
      labels: { le: "+Inf", method: "GET" },
      value: 9,
    });
    expect(parsePromLine("http_request_duration_seconds_sum 1.5")).toMatchObject({ value: 1.5 });
    expect(parsePromLine("http_request_duration_seconds_count 9")).toMatchObject({ value: 9 });
  });

  it("unescapes label values: backslash, quote and newline", () => {
    expect(parsePromLine('weird{msg="a\\\\b \\"quoted\\" and\\nnewline"} 1')).toEqual({
      name: "weird",
      labels: { msg: 'a\\b "quoted" and\nnewline' },
      value: 1,
    });
  });

  it("keeps commas and braces inside quoted label values", () => {
    expect(parsePromLine('m{a="x,y}z",b="w"} 2')).toEqual({
      name: "m",
      labels: { a: "x,y}z", b: "w" },
      value: 2,
    });
  });

  it("ignores HELP and TYPE comments and blank lines", () => {
    expect(parsePromLine("# HELP http_requests_total HTTP requests handled.")).toBeNull();
    expect(parsePromLine("# TYPE http_requests_total counter")).toBeNull();
    expect(parsePromLine("")).toBeNull();
    expect(parsePromLine("   ")).toBeNull();
  });

  it("parses non-finite values as they are written", () => {
    // MySQL DOUBLE cannot store them — the row mapper drops non-finite values, not the parser:
    // parsing and storability are different questions.
    expect(parsePromLine("m +Inf")).toMatchObject({ value: Number.POSITIVE_INFINITY });
    expect(parsePromLine("m -Inf")).toMatchObject({ value: Number.NEGATIVE_INFINITY });
    expect(parsePromLine("m NaN")?.value).toBeNaN();
  });

  it("ignores a trailing timestamp", () => {
    expect(parsePromLine("m 3.2 1787427015000")).toMatchObject({ name: "m", value: 3.2 });
  });

  it("returns null for garbage instead of throwing", () => {
    expect(parsePromLine("<html>502 Bad Gateway</html>")).toBeNull();
    expect(parsePromLine('m{unclosed="x 1')).toBeNull();
    expect(parsePromLine("m{a=b} 1")).toBeNull();
    expect(parsePromLine("m ")).toBeNull();
    expect(parsePromLine("m notanumber")).toBeNull();
    expect(parsePromLine('{le="1"} 3')).toBeNull();
  });

  it("accepts colons in metric names, as recording-rule style names use", () => {
    expect(parsePromLine("job:availability:ratio 0.99")).toMatchObject({ name: "job:availability:ratio" });
  });
});
