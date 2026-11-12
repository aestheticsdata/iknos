import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { readRun } from "../runs/run-reading";
import { eventsFromRow, factFromRow } from "../runs/span-facts";
import { TracesService } from "../traces.service";
import { hasInputs, testCalls } from "./test-calls";

import type { AiRunSummary } from "@contracts/ai-runs";
import type { TestCall, TestSetRun, TestSetSummary } from "@contracts/test-sets";
import type { TestSet, TestSetRun as TestSetRunRow } from "@generated/prisma/client";

/**
 * Test sets of AI runs (IKN-95). A run is copied in — its summary and its model calls — when it is
 * added, from the spans still held, so the set keeps it after the retention has dropped them.
 *
 * Adding a run copies its content out of the sender's retention on purpose: it is a reader's
 * explicit "keep this case". The set page says so, and removing the run removes the copy.
 */

/** The spans are read over the whole span retention: a run can be added as long as it is held. */
const LOOKBACK_MS = 15 * 86_400_000;

type SetWithCount = TestSet & { runs: number; lastAddedAt: Date | null };

const summaryOf = (set: SetWithCount): TestSetSummary => ({
  id: set.id,
  service: set.service,
  name: set.name,
  createdAt: set.createdAt.toISOString(),
  runs: set.runs,
  lastAddedAt: set.lastAddedAt?.toISOString() ?? null,
});

const runOf = (row: TestSetRunRow): TestSetRun => {
  const calls = row.calls as unknown as TestCall[];
  return {
    id: row.id,
    traceId: row.traceId,
    addedAt: row.addedAt.toISOString(),
    run: row.run as unknown as AiRunSummary,
    calls,
    hasInputs: hasInputs(calls),
  };
};

@Injectable()
export class TestSetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly traces: TracesService,
  ) {}

  /** One service's sets, or every service's; newest first. */
  async list(service: string | null): Promise<TestSetSummary[]> {
    const sets = await this.prisma.testSet.findMany({
      where: service === null ? {} : { service },
      orderBy: { createdAt: "desc" },
    });
    const counts = await this.prisma.testSetRun.groupBy({
      by: ["setId"],
      where: { setId: { in: sets.map((set) => set.id) } },
      _count: { _all: true },
      _max: { addedAt: true },
    });
    const bySet = new Map(counts.map((count) => [count.setId, count]));
    return sets.map((set) =>
      summaryOf({
        ...set,
        runs: bySet.get(set.id)?._count._all ?? 0,
        lastAddedAt: bySet.get(set.id)?._max.addedAt ?? null,
      }),
    );
  }

  async detail(id: number): Promise<{ set: TestSetSummary; runs: TestSetRun[] }> {
    const set = await this.prisma.testSet.findUnique({ where: { id } });
    if (!set) throw new NotFoundException("no such test set");
    const rows = await this.prisma.testSetRun.findMany({ where: { setId: id }, orderBy: { addedAt: "desc" } });
    return {
      set: summaryOf({ ...set, runs: rows.length, lastAddedAt: rows[0]?.addedAt ?? null }),
      runs: rows.map(runOf),
    };
  }

  async create(service: string, name: string): Promise<TestSetSummary> {
    try {
      const set = await this.prisma.testSet.create({ data: { service, name } });
      return summaryOf({ ...set, runs: 0, lastAddedAt: null });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`${service} already has a set named "${name}"`);
      }
      throw error;
    }
  }

  /** Adds a run, copied from its spans; adding it twice returns the copy already there. */
  async addRun(setId: number, traceId: string): Promise<TestSetRun> {
    const set = await this.prisma.testSet.findUnique({ where: { id: setId } });
    if (!set) throw new NotFoundException("no such test set");
    const existing = await this.prisma.testSetRun.findUnique({ where: { setId_traceId: { setId, traceId } } });
    if (existing) return runOf(existing);

    const now = Date.now();
    const { spans } = await this.traces.spans(traceId, new Date(now - LOOKBACK_MS), new Date(now + 3_600_000));
    if (spans.length === 0) throw new NotFoundException("no span of this run is held any more");
    const summary = readRun(
      spans.map((row) => factFromRow(traceId, row)),
      spans.flatMap((row) => eventsFromRow(traceId, row)),
    ).summary;
    if (summary.service !== set.service) {
      throw new ConflictException(`this run belongs to ${summary.service}, the set to ${set.service}`);
    }

    const row = await this.prisma.testSetRun.create({
      data: {
        setId,
        traceId,
        run: summary as unknown as Prisma.InputJsonValue,
        calls: testCalls(spans) as unknown as Prisma.InputJsonValue,
      },
    });
    return runOf(row);
  }

  async removeRun(setId: number, runId: number): Promise<void> {
    const { count } = await this.prisma.testSetRun.deleteMany({ where: { id: runId, setId } });
    if (count === 0) throw new NotFoundException("no such run in this set");
  }

  /** The set and every copy it holds, together. */
  async remove(id: number): Promise<void> {
    const [, removed] = await this.prisma.$transaction([
      this.prisma.testSetRun.deleteMany({ where: { setId: id } }),
      this.prisma.testSet.deleteMany({ where: { id } }),
    ]);
    if (removed.count === 0) throw new NotFoundException("no such test set");
  }
}
