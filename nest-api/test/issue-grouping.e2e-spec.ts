import { PrismaService } from "@db/prisma.service";
import { GrouperService, SETTLE_MS } from "@issues/grouper.service";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * IKN-9's acceptance criteria, against a real MySQL — because every one of them is a claim about
 * what the *database* holds after the pass, and the interesting parts are the ones a mock cannot
 * answer: that `ON DUPLICATE KEY UPDATE` folds rather than duplicates, that `first_seen` cannot
 * drift because no statement assigns it, and that the regression flag is computed while `status`
 * still holds its old value.
 *
 * The fingerprint arithmetic is proven without a database in `src/issues/fingerprint.spec.ts`,
 * and the rejoining of multi-line stacks in `src/issues/coalesce.spec.ts`. What is left is the
 * writing.
 *
 * **This suite writes to the real `log_entry`, `issue` and `issue_event`.** Every row it inserts
 * carries a service name of its own, and it deletes them on the way in and the way out, so it
 * takes nothing else with it.
 */

const prisma = new PrismaService();
const SERVICE = "iknos-test-grouper";

/** Comfortably past `SETTLE_MS`, so every seeded row is settled by the time the pass reads. */
const AGO_MS = SETTLE_MS + 60_000;

/** A log row as the collector would have written it, `ms` before now. */
async function seed(message: string, ms: number, attrs: Record<string, unknown> | null = null): Promise<void> {
  await prisma.logEntry.create({
    data: {
      ts: new Date(Date.now() - ms),
      service: SERVICE,
      level: 50,
      levelName: "error",
      message,
      traceId: null,
      attrs: (attrs ?? undefined) as never,
    },
  });
}

const ecs = (type: string, message: string, stack: string) => ({
  error: { type, message, stack_trace: stack },
});

const STACK = [
  "ConnectionAcquireTimeoutError: pool timeout",
  "    at acquire (/var/www/pfa/nest-api/dist/queue/export.js:142:15)",
  "    at exportAll (/var/www/pfa/nest-api/dist/queue/export.js:31:9)",
].join("\n");

const issues = () => prisma.issue.findMany({ where: { service: SERVICE }, orderBy: { id: "asc" } });

async function wipe(): Promise<void> {
  const mine = await prisma.issue.findMany({ where: { service: SERVICE }, select: { id: true } });
  if (mine.length > 0) {
    await prisma.issueEvent.deleteMany({ where: { issueId: { in: mine.map((i) => i.id) } } });
  }
  await prisma.issue.deleteMany({ where: { service: SERVICE } });
  await prisma.logEntry.deleteMany({ where: { service: SERVICE } });
}

/** A grouper with no memory of previous tests — the watermark reseeds from an empty `issue`. */
const grouper = () => new GrouperService(prisma);

beforeEach(async () => {
  await prisma.$connect();
  await wipe();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("issue grouping", () => {
  it("turns a hundred identical exceptions into one issue with a count of a hundred", async () => {
    for (let i = 0; i < 100; i += 1) {
      await seed("pool timeout", AGO_MS - i, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));
    }

    await grouper().pass(Date.now());

    const rows = await issues();
    expect(rows).toHaveLength(1);
    expect(rows[0].eventCount).toBe(100);
    expect(rows[0].type).toBe("ConnectionAcquireTimeoutError");
    expect(rows[0].status).toBe("unresolved");
    // One stack kept, not a hundred: the cap is on rows, never on the count.
    const events = await prisma.issueEvent.count({ where: { issueId: rows[0].id } });
    expect(events).toBeLessThan(100);
    expect(events).toBeGreaterThan(0);
  });

  it("rejoins a plain-text stack instead of making an issue per line", async () => {
    // The case that decided the whole design: an app writing to stderr emits one exception as a
    // header and its frames, and PM2 stamps every line `error`.
    await seed("TypeError: cannot read 'siret' of undefined", AGO_MS);
    await seed("    at normalize (/var/www/pfa/nest-api/dist/dossiers/normalize.js:88:14)", AGO_MS - 1);
    await seed("    at map (<anonymous>)", AGO_MS - 2);

    await grouper().pass(Date.now());

    const rows = await issues();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("TypeError");
    expect(rows[0].eventCount).toBe(1);
    expect(rows[0].culprit).toContain("dist/dossiers/normalize.js:88");
  });

  it("keeps two different errors apart", async () => {
    await seed("pool timeout", AGO_MS, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));
    await seed(
      "boom",
      AGO_MS - 1,
      ecs(
        "RangeError",
        "Maximum call stack size exceeded",
        "RangeError: boom\n    at render (/var/www/pfa/nest-api/dist/pdf/render.js:204:9)",
      ),
    );

    await grouper().pass(Date.now());

    expect(await issues()).toHaveLength(2);
  });

  it("does not raise an issue for a line that is merely angry", async () => {
    await seed("failed to connect, retrying", AGO_MS);
    await seed("listening on :3000", AGO_MS - 1);

    await grouper().pass(Date.now());

    expect(await issues()).toEqual([]);
  });

  it("never moves first_seen, and folds later occurrences into the same row", async () => {
    await seed("pool timeout", AGO_MS + 600_000, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));
    await grouper().pass(Date.now());

    const [before] = await issues();
    expect(before.eventCount).toBe(1);

    // A second pass, a fresh grouper (as after a restart), a newer occurrence.
    await seed("pool timeout", AGO_MS, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));
    await grouper().pass(Date.now());

    const [after] = await issues();
    expect(after.id).toBe(before.id);
    expect(after.eventCount).toBe(2);
    expect(after.firstSeen.getTime()).toBe(before.firstSeen.getTime());
    expect(after.lastSeen.getTime()).toBeGreaterThan(before.lastSeen.getTime());
  });

  it("reopens a resolved issue and marks it a regression", async () => {
    await seed("pool timeout", AGO_MS + 600_000, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));
    await grouper().pass(Date.now());

    const [first] = await issues();
    await prisma.issue.update({ where: { id: first.id }, data: { status: "resolved", regression: false } });

    await seed("pool timeout", AGO_MS, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));
    await grouper().pass(Date.now());

    const [reopened] = await issues();
    expect(reopened.status).toBe("unresolved");
    // The flag is computed while `status` still says "resolved" — swap the two assignments in the
    // upsert and this is the test that fails.
    expect(reopened.regression).toBe(true);
  });

  it("leaves an ignored issue ignored", async () => {
    await seed("pool timeout", AGO_MS + 600_000, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));
    await grouper().pass(Date.now());

    const [first] = await issues();
    await prisma.issue.update({ where: { id: first.id }, data: { status: "ignored" } });

    await seed("pool timeout", AGO_MS, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));
    await grouper().pass(Date.now());

    const [after] = await issues();
    expect(after.status).toBe("ignored");
    expect(after.regression).toBe(false);
    // Still counted: ignoring an issue silences it, it does not stop the world.
    expect(after.eventCount).toBe(2);
  });

  it("will not read rows that have not settled", async () => {
    // Written now, so inside SETTLE_MS. Reading them would let a later-arriving row of the same
    // millisecond fall behind the watermark and be lost.
    await seed("pool timeout", 0, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));

    await grouper().pass(Date.now());

    expect(await issues()).toEqual([]);
  });

  it("resumes from what it has already grouped rather than re-counting it", async () => {
    await seed("pool timeout", AGO_MS, ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK));

    await grouper().pass(Date.now());
    // A brand-new instance: no in-memory watermark, so it reseeds from MAX(issue.last_seen).
    await grouper().pass(Date.now());

    const [row] = await issues();
    expect(row.eventCount).toBe(1);
  });

  it("survives a log line whose error fields overflow their columns", async () => {
    // `attrs` is the one column the ingest writer does not clamp (writer.ts:75), and `error.*`
    // lives inside it — never promoted, so it reaches log_entry at up to the parser's 1 MB line
    // cap. Written straight into VARCHAR(255)/TEXT that is MySQL error 1406, which in strict mode
    // fails the whole statement. An app doing `throw new Error(\`upstream ${res.status}:
    // ${await res.text()}\`)` against a service answering with an HTML page produces exactly it.
    const huge = "x".repeat(100_000);
    await seed(
      "upstream failed",
      AGO_MS,
      ecs("A".repeat(400), huge, `Error: ${huge}\n    at f (/var/www/pfa/nest-api/dist/a.js:1:2)`),
    );
    // A second, ordinary error ordered after it: before the clamp this one vanished with the pass.
    await seed(
      "boom",
      AGO_MS - 1,
      ecs("RangeError", "boom", "RangeError: boom\n    at render (/var/www/pfa/nest-api/dist/pdf/render.js:204:9)"),
    );

    await expect(grouper().pass(Date.now())).resolves.toBeGreaterThan(0);

    const rows = await issues();
    expect(rows).toHaveLength(2);
    // Truncated rather than refused: a clipped stack still identifies the bug.
    const overflowed = rows.find((r) => r.type?.startsWith("A"));
    expect(overflowed?.type).toHaveLength(255);
    expect(Buffer.byteLength(overflowed?.message ?? "")).toBeLessThanOrEqual(60_000);
    // And the one behind it in the batch survived, which is the whole point.
    expect(rows.some((r) => r.type === "RangeError")).toBe(true);
  });

  it("records the occurrence's trace id so the logs of that request are reachable", async () => {
    await prisma.logEntry.create({
      data: {
        ts: new Date(Date.now() - AGO_MS),
        service: SERVICE,
        level: 50,
        levelName: "error",
        message: "pool timeout",
        traceId: "4f2ab91c9c0e17d44f2ab91c9c0e17d4",
        attrs: ecs("ConnectionAcquireTimeoutError", "pool timeout", STACK),
      },
    });

    await grouper().pass(Date.now());

    const [row] = await issues();
    const [event] = await prisma.issueEvent.findMany({ where: { issueId: row.id } });
    expect(event.traceId).toBe("4f2ab91c9c0e17d44f2ab91c9c0e17d4");
  });
});
