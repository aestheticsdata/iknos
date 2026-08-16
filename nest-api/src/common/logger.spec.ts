import { describe, expect, it } from "vitest";
import { buildLogger, INGEST_SKIP_MARKER } from "./logger";

function capture(fn: (write: (chunk: string) => void) => void): string[] {
  const lines: string[] = [];
  fn((chunk) => lines.push(chunk));
  return lines;
}

describe("logger", () => {
  it("emits ECS-shaped NDJSON", () => {
    const lines = capture((write) => {
      const log = buildLogger("info", { write });
      log.info("resumed at offset 4096");
    });

    const parsed = JSON.parse(lines[0]);
    expect(parsed["@timestamp"]).toBeTruthy();
    expect(parsed["log.level"]).toBe("info");
    expect(parsed.message).toBe("resumed at offset 4096");
    expect(parsed["service.name"]).toBe("iknos");
    expect(parsed["ecs.version"]).toBeTruthy();
  });

  it("keeps one event on one line even with newlines in the message", () => {
    const lines = capture((write) => {
      const log = buildLogger("info", { write });
      log.info("a\nb\tc");
    });

    // Trailing newline aside, an event must never span two records: it would be re-ingested as
    // several rows, one of which is invalid JSON.
    expect(lines[0].trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(lines[0]).message).toBe("a\nb\tc");
  });

  it("exports a marker the ingest parser can recognise", () => {
    expect(INGEST_SKIP_MARKER).toBe("IKNOS_SELF_ERR");
  });

  it("honours the configured level", () => {
    const lines = capture((write) => {
      const log = buildLogger("warn", { write });
      log.debug("should not appear");
      log.warn("should appear");
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).message).toBe("should appear");
  });

  it("serialises an error with its type and stack, which the parser maps to ECS", () => {
    const lines = capture((write) => {
      const log = buildLogger("info", { write });
      log.error({ err: new TypeError("boom") }, "unhandled exception");
    });

    const parsed = JSON.parse(lines[0]);
    // Task 9's fingerprint is built from `error.type` plus the stack, so both must survive the
    // trip through the log file rather than being flattened to a string.
    expect(parsed.error?.type).toBe("TypeError");
    expect(parsed.error?.stack_trace).toContain("boom");
  });
});
