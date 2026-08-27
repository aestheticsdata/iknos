import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { SIGNALS_MAX_EXECUTION_MS, SIGNALS_TOO_SLOW, SignalsService } from "./signals.service";

import type { PrismaService } from "@db/prisma.service";

/**
 * What happens when `MAX_EXECUTION_TIME` fires (IKN-10 follow-up).
 *
 * The hint itself is MySQL's to honour and is verified against a real server, not here — a unit
 * test cannot tell a working hint from a silently ignored one, which is the failure mode that
 * matters. What *is* worth pinning is the translation: a scan MySQL cut short must reach the view
 * as a 503 saying so, and every other database failure must pass through untouched, because
 * folding the two together is how "the database is down" would come to read as "narrow the range".
 */

const throwing = (err: Error): PrismaService =>
  ({
    $queryRaw: () => Promise.reject(err),
  }) as unknown as PrismaService;

/** The shape Prisma wraps a server-side error in — the code travels in the message, nowhere else. */
const prismaWrapped = (code: string, message: string): Error =>
  new Error(
    `\nInvalid \`prisma.$queryRaw()\` invocation:\n\nRaw query failed. Code: \`${code}\`. Message: \`${message}\``,
  );

/**
 * Reassembles what `$queryRaw` was actually handed.
 *
 * `Prisma.raw` arrives as a value beside the template, not as part of it, so the ceiling is only
 * in the statement if both halves survive — this is the one assertion that can tell a hint that
 * was written from a hint that was rendered.
 */
const capturing = (seen: string[]): PrismaService =>
  ({
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      seen.push(
        strings.raw.reduce((acc, part, i) => {
          const v = values[i - 1];
          const rendered = v !== null && typeof v === "object" && "sql" in v ? String((v as { sql: string }).sql) : "?";
          return `${acc}${rendered}${part}`;
        }),
      );
      return Promise.resolve([]);
    },
  }) as unknown as PrismaService;

const NOW = new Date("2026-08-25T21:00:00.000Z");
const FROM = new Date("2026-08-25T20:45:00.000Z");

const read = (err: Error): Promise<unknown> =>
  new SignalsService(throwing(err), 3).signals("pfa-nest-api", FROM, NOW, NOW);

describe("SignalsService, when the scan is cut short", () => {
  it("answers 503 rather than empty tiles", async () => {
    const err = prismaWrapped("3024", "Query execution was interrupted, maximum statement execution time exceeded");

    await expect(read(err)).rejects.toThrow(ServiceUnavailableException);
    await expect(read(err)).rejects.toThrow(SIGNALS_TOO_SLOW);
  });

  it("matches on the wording too, for a driver that stops quoting the code", async () => {
    const err = new Error("Query execution was interrupted, maximum statement execution time exceeded");

    await expect(read(err)).rejects.toThrow(ServiceUnavailableException);
  });

  it("lets every other database failure through unchanged", async () => {
    const err = prismaWrapped("45028", "pool timeout: failed to retrieve a connection from pool after 10000ms");

    await expect(read(err)).rejects.toThrow(/pool timeout/);
    await expect(read(err)).rejects.not.toThrow(ServiceUnavailableException);
  });
});

describe("the ceiling itself", () => {
  it("reaches MySQL inside the statement, not merely in the source", async () => {
    const seen: string[] = [];
    await new SignalsService(capturing(seen), 3).signals("pfa-nest-api", FROM, NOW, NOW);

    expect(seen).not.toHaveLength(0);
    for (const sql of seen) {
      expect(sql).toMatch(new RegExp(`MAX_EXECUTION_TIME\\(${SIGNALS_MAX_EXECUTION_MS}\\)`));
    }
  });
});
