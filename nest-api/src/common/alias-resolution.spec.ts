import { timingSafeCompare } from "@common/timing-safe";
import { JSON_BODY_LIMIT } from "@config/body-limit";
import { MAX_EVENTS_PER_REQUEST } from "@ingest/http-ingest.service";
import { describe, expect, it } from "vitest";

/**
 * A canary for the path aliases, not a test of the things it imports.
 *
 * Three of the mechanisms that resolve `@config/…` are independent of each other, and only one of
 * them is exercised by the rest of the suite:
 *
 * - `nest build` rewrites aliases at emit time through its own TS transformer hook, so the app and
 *   everything in `dist/` never see an alias. Nothing here can check that; `pnpm build` does.
 * - vitest resolves them through `resolve.tsconfigPaths`, which is what this file checks.
 * - tsx resolves them natively for `prisma/seed.ts` and `scripts/create-account.ts`.
 *
 * The vitest leg is the fragile one. `resolve.tsconfigPaths` is native to vite 8; vite 6 and 7 do
 * not validate unknown configuration keys, so on a downgrade the option would be ignored without a
 * word and every aliased import in the suite would fail at once — a hundred red tests pointing at
 * everything except the cause. This file fails first and says what happened.
 */
describe("path aliases", () => {
  it("resolves under vitest, which needs `resolve.tsconfigPaths` in vitest.config.mts", () => {
    expect(JSON_BODY_LIMIT).toBe("1mb");
    expect(MAX_EVENTS_PER_REQUEST).toBe(100);
    expect(timingSafeCompare("abc", "abc")).toBe(true);
  });
});
