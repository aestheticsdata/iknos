import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { encodeCursor } from "./cursor";
import { HistogramService } from "./histogram.service";
import { LogQueryDto, parseDir, parseFilters, parseLimit, parseRowId, parseWindow, resolveCursor } from "./log-query";
import { LogsService } from "./logs.service";
import { toLogDetail, toLogRow } from "./row";
import { TraceService } from "./trace.service";

import type { Histogram } from "@contracts/histogram";
import type { LogDetail } from "@contracts/log-detail";
import type { LogPage } from "@contracts/log-page";
import type { Trace } from "@contracts/trace";

/**
 * The four read routes the Logs view needs. All behind the global session guard — none of them
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
    const dir = parseDir(p.dir);
    // A cursor (or `at`) that does not resolve is treated as no cursor rather than as an error: it
    // comes from a URL, so a truncated copy-paste means "start from the top", not a 400.
    const cursor = resolveCursor(p);

    const startedAt = performance.now();
    // One row more than asked for, purely to learn whether another page exists. A `COUNT(*)` over
    // the same predicate would double the work to answer a question the extra row answers free.
    const found = await this.logs.search(filters, limit + 1, cursor, dir);
    const tookMs = Math.round(performance.now() - startedAt);

    const hasMore = found.length > limit;
    // Trimmed while the array is still in the order the cursor produced it — `found`'s first
    // `limit` elements are always "nearest the cursor" whichever way `dir` walked, so this is the
    // one slice that is correct for both directions. Trimming *after* flipping to newest-first
    // would keep the wrong end for `"after"`: reversed first, the farthest (overflow) row lands at
    // the front and the nearest rows — the ones actually worth keeping — fall off the end instead.
    const trimmed = found.slice(0, limit);
    const page = dir === "before" ? trimmed : trimmed.reverse();
    // The boundary row to hand a continuation cursor for sits at the opposite end of `page`
    // depending on direction: continuing further before the oldest row means the last element,
    // continuing further after the newest row means the first — true of `page` now that it is
    // newest-first either way.
    const boundary = dir === "before" ? page.at(-1) : page[0];

    return {
      rows: page.map(toLogRow),
      nextCursor: hasMore && boundary ? encodeCursor(boundary.ts, boundary.id) : null,
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

  /**
   * One row in full — the columns the list leaves behind, for the line that was expanded (IKN-58).
   *
   * **`entry/:id`, not `:id`, and that is not decoration.** Express matches in registration order,
   * Nest registers in the order of the `controllers` array, and `StreamController` mounts
   * `GET /api/logs/stream` on this very prefix from further down that array. A bare `:id` here
   * would match `stream` first and the live tail would quietly become a 400 — a breakage whose
   * cause would be an array's order in another file. A segment of its own cannot collide with
   * anything, whoever edits that array later.
   *
   * Bounded like every other route, and here the *primary key* is what needs it — see
   * `LogsService.byId`.
   *
   * An id that is not in the range is a **404**, unlike an unknown trace id, which is an empty
   * result. The difference is what the caller is claiming: a trace id is a question that may have
   * no answer, while a row id came off a line the caller has already been shown, so nothing there
   * means the row has aged out of retention or the window is wrong — and both are worth saying.
   */
  @Get("entry/:id")
  async detail(@Param("id") id: string, @Query() p: LogQueryDto): Promise<LogDetail> {
    const { from, to } = parseWindow(p);

    const row = await this.logs.byId(parseRowId(id), from, to);
    if (row === null) throw new NotFoundException("no such log line in this range");

    return toLogDetail(row);
  }
}
