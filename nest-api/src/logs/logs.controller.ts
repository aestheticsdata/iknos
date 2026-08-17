import { Controller, Get, Param, Query } from "@nestjs/common";
import { decodeCursor, encodeCursor } from "./cursor";
import { HistogramService } from "./histogram.service";
import { LogQueryDto, parseFilters, parseLimit, parseWindow } from "./log-query";
import { LogsService } from "./logs.service";
import { toLogRow } from "./row";
import { TraceService } from "./trace.service";

import type { Histogram } from "../contracts/histogram";
import type { LogPage } from "../contracts/log-page";
import type { Trace } from "../contracts/trace";

/**
 * The three read routes the Logs view needs. All behind the global session guard — none of them
 * carries `@Public()`, which is the whole point of the guard being deny-by-default.
 *
 * Every one of them requires `from` and `to`. That is not validation politeness: `log_entry` is
 * partitioned by day, and the range predicate is what lets MySQL discard whole partitions before
 * looking at a single row. A widened default would turn one forgotten parameter into a full scan
 * of the retention period.
 */
@Controller("api/logs")
export class LogsController {
  constructor(
    private readonly logs: LogsService,
    private readonly histograms: HistogramService,
    private readonly traces: TraceService,
  ) {}

  @Get()
  async list(@Query() p: LogQueryDto): Promise<LogPage> {
    const filters = parseFilters(p);
    const limit = parseLimit(p.limit);
    // A cursor that does not decode is treated as no cursor rather than as an error: it comes
    // from a URL, so a truncated copy-paste means "start from the top", not "400".
    const cursor = p.cursor ? (decodeCursor(p.cursor) ?? undefined) : undefined;

    const startedAt = performance.now();
    // One row more than asked for, purely to learn whether another page exists. A `COUNT(*)` over
    // the same predicate would double the work to answer a question the extra row answers free.
    const found = await this.logs.search(filters, limit + 1, cursor);
    const tookMs = Math.round(performance.now() - startedAt);

    const hasMore = found.length > limit;
    const page = found.slice(0, limit);
    const last = page.at(-1);

    return {
      rows: page.map(toLogRow),
      nextCursor: hasMore && last ? encodeCursor(last.ts, last.id) : null,
      meta: { tookMs },
    };
  }

  @Get("histogram")
  async histogram(@Query() p: LogQueryDto): Promise<Histogram> {
    const filters = parseFilters(p);

    const startedAt = performance.now();
    const { bucketMs, buckets } = await this.histograms.histogram(filters);

    return { bucketMs, buckets, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }

  /**
   * Bounded like everything else, and for the same reason: `(trace_id, ts)` is indexed, but
   * looking up an id that appears nowhere still walks that index across every partition. The view
   * always has a range to hand, so this costs the caller nothing.
   *
   * An unknown trace id is an empty result, not a 404. The caller asked a well-formed question
   * and "nothing" is the answer to it.
   */
  @Get("trace/:traceId")
  async trace(@Param("traceId") traceId: string, @Query() p: LogQueryDto): Promise<Trace> {
    const { from, to } = parseWindow(p);

    const startedAt = performance.now();
    const { rows, totalMs, truncated } = await this.traces.byTraceId(traceId, from, to);

    return { traceId, rows, totalMs, truncated, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }
}
