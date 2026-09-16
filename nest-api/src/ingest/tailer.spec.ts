import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Tailer } from "./tailer";

import type { LogRecord } from "./log-record";
import type { Source, SourceFile } from "./source";
import type { Chunk } from "./writer";

/** The tailer only ever carries a record through; it never reads one. This is enough to be one. */
const record = (service: string, message: string): LogRecord => ({
  ts: new Date(),
  service,
  level: 30,
  levelName: "info",
  logger: null,
  message,
  traceId: null,
  httpMethod: null,
  route: null,
  statusCode: null,
  durationMs: null,
  clientIp: null,
  userId: null,
  hostname: null,
  attrs: null,
});

/** A source over files that already exist, whose parser tags each line with the source's name. */
const sourceOver = (name: string, files: SourceFile[]): Source => ({
  name,
  files: async () => files,
  parse: (line, service) => record(service, `${name}:${line}`),
});

describe("Tailer over several sources", () => {
  it("sweeps every source in one pass, each through its own parser", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-src-"));
    const a = path.join(dir, "a.log");
    const b = path.join(dir, "b.log");
    await writeFile(a, "one\n");
    await writeFile(b, "two\n");

    const chunks: Chunk[] = [];
    const tailer = new Tailer(
      [
        sourceOver("pm2", [{ file: a, service: "app-a", stream: "out" }]),
        sourceOver("nginx", [{ file: b, service: "site-b", stream: "out" }]),
      ],
      (chunk) => chunks.push(chunk),
    );

    await tailer.poll();

    const seen = chunks.flatMap((c) => c.records.map((r) => `${r.service} ${r.message}`));
    // Each line went through the parser belonging to the source that listed its file, which is
    // the whole point of the seam.
    expect(seen).toContain("app-a pm2:one");
    expect(seen).toContain("site-b nginx:two");
  });

  it("keeps sweeping when one source cannot list its files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-src-"));
    const a = path.join(dir, "a.log");
    await writeFile(a, "still here\n");

    const broken: Source = {
      name: "nginx",
      // What a database outage looks like from here: the nginx source finds its files in MySQL.
      files: async () => {
        throw new Error("database is down");
      },
      parse: (line, service) => record(service, line),
    };

    const chunks: Chunk[] = [];
    const tailer = new Tailer([broken, sourceOver("pm2", [{ file: a, service: "app-a", stream: "out" }])], (chunk) =>
      chunks.push(chunk),
    );

    // Never throws out of poll: the interval driving it would otherwise take the process down.
    await expect(tailer.poll()).resolves.toBeUndefined();

    // And the PM2 lines still landed — which is the point, because they are exactly what somebody
    // is reading while MySQL is the problem.
    // Tagged `pm2:` by that source's own parser — which is the second thing this proves: the
    // surviving source read its line through its own parser, not through the broken one's.
    expect(chunks.flatMap((c) => c.records.map((r) => r.message))).toContain("pm2:still here");
    // The pass completed, so the heartbeat is stamped and the collector does not read as dead.
    expect(tailer.lastPollAt).not.toBeNull();
  });

  it("follows both sources' files without their offsets colliding", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-src-"));
    const a = path.join(dir, "a.log");
    const b = path.join(dir, "b.log");
    await writeFile(a, "one\n");
    await writeFile(b, "two\n");

    const chunks: Chunk[] = [];
    const tailer = new Tailer(
      [
        sourceOver("pm2", [{ file: a, service: "app-a", stream: "out" }]),
        sourceOver("nginx", [{ file: b, service: "site-b", stream: "out" }]),
      ],
      (chunk) => chunks.push(chunk),
    );

    await tailer.poll();
    // `state` is keyed by path, so two sources cannot overwrite each other in it.
    expect(tailer.trackedFiles).toBe(2);

    // A second pass finds no new bytes in either and submits nothing more. An offset shared
    // between the two files would show up here as a re-read.
    const after = chunks.length;
    await tailer.poll();
    expect(chunks.length).toBe(after);
  });
});
