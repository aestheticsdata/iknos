import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService, SESSION_PREFIX } from "./redis.service";

/**
 * Against a real Redis, not a fake.
 *
 * `clearSessionsForUser` is a SCAN over a keyspace shared with every other app on ks-b, and the
 * only interesting failure modes — the match pattern being wrong, a malformed entry aborting
 * the sweep — are exactly the ones a fake would be written not to have.
 *
 * Every key this file writes carries a random suffix and is deleted afterwards, so a run cannot
 * collide with a live session or with a second run.
 */
describe("RedisService", () => {
  let service: RedisService;
  const written: string[] = [];
  const run = randomUUID();

  async function writeSession(sid: string, value: string): Promise<string> {
    const key = `${SESSION_PREFIX}${run}-${sid}`;
    await service.getClient().set(key, value);
    written.push(key);
    return key;
  }

  beforeAll(async () => {
    service = new RedisService();
    service.onModuleInit();
    await service.ready();
  });

  afterAll(async () => {
    if (written.length > 0) await service.getClient().del(written);
    await service.onModuleDestroy();
  });

  it("connects", () => {
    expect(service.getClient().isReady).toBe(true);
  });

  it("deletes only the sessions belonging to the user", async () => {
    const mine = await writeSession("mine", JSON.stringify({ userId: 1 }));
    const theirs = await writeSession("theirs", JSON.stringify({ userId: 2 }));

    await service.clearSessionsForUser(1);

    expect(await service.getClient().exists(mine)).toBe(0);
    expect(await service.getClient().exists(theirs)).toBe(1);
  });

  it("finishes the sweep when an entry is not valid JSON", async () => {
    // A half-written value, or a key some other tool put under the prefix. An uncaught throw
    // here would leave every session after it in the scan alive — including the one the user
    // just asked to revoke.
    await writeSession("garbage", "{not json");
    const mine = await writeSession("after-garbage", JSON.stringify({ userId: 3 }));

    await service.clearSessionsForUser(3);

    expect(await service.getClient().exists(mine)).toBe(0);
  });

  it("does not touch keys outside the session prefix", async () => {
    const foreign = `iknos:not-a-session:${run}`;
    await service.getClient().set(foreign, JSON.stringify({ userId: 4 }));
    written.push(foreign);

    await service.clearSessionsForUser(4);

    expect(await service.getClient().exists(foreign)).toBe(1);
  });
});
