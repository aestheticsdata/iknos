import { encodeKeysetCursor } from "@common/keyset-cursor";
import { chooseBucketMs } from "@logs/histogram.service";
import { LogQueryDto, parseRowId, parseWindow } from "@logs/log-query";
import { LogsService } from "@logs/logs.service";
import { Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import {
  IssueQueryDto,
  OccurrenceQueryDto,
  parseFilters,
  parseFingerprint,
  parseLimit,
  parseOccurrenceWindow,
  parseSort,
  resolveCursor,
  SORTS,
} from "./issue-query";
import { toIssueDetail, toIssueRow } from "./issue-row";
import { IssuesService, SPARK_BUCKETS, SPARK_WINDOW_MS } from "./issues.service";
import { fingerprintForLog, LOOKAROUND_MS } from "./log-link";

import type { IssueDetail } from "@contracts/issue-detail";
import type { IssueCounts, IssuePage } from "@contracts/issue-page";
import type { OccurrenceSeries } from "@contracts/occurrence-series";

/**
 * The issues view's routes (IKN-14) — the list, its segment counts, one issue in full, its
 * occurrences over time, and the three state changes.
 *
 * All behind the global session guard, none carrying `@Public()`. The mutations need nothing
 * added here either: `SessionGuard` demands the CSRF header on every method that is not safe, so
 * a `@Post` is protected because it is a `@Post`.
 *
 * **Every route is keyed on the fingerprint, never on `issue.id`.** The integer id exists so
 * `issue_event.issue_id` can be narrow; it names nothing the reader has seen. Routing on it would
 * mean the identifier printed on the row is not the one in the address bar.
 */
@Controller("api/issues")
export class IssuesController {
  constructor(
    private readonly issues: IssuesService,
    private readonly logs: LogsService,
  ) {}

  /**
   * `counts` is declared **before** `:fingerprint` — Express matches in registration order, and a
   * bare parameter above a literal segment swallows it. `logs.controller.ts:98-103` records the
   * same lesson from the other side, where the collision was with another controller entirely.
   */
  @Get("counts")
  async counts(@Query() p: IssueQueryDto): Promise<IssueCounts> {
    return this.issues.counts(parseFilters(p));
  }

  /**
   * The issue a log line was grouped into — `⌘I` on the selected row (IKN-14).
   *
   * Declared above `:fingerprint/occurrences` for the reason `counts` is above `:fingerprint`: two
   * segments match two segments, and `for-log` would otherwise be read as a fingerprint.
   *
   * Bounded like every log route, and here it is the primary key that needs it — `log_entry` is
   * partitioned by day and keyed on `(id, ts)`, so `WHERE id = ?` alone probes every partition.
   * The caller is asking about a line it is looking at, so the range costs it nothing.
   *
   * **A 404 covers three different absences**, and deliberately: the line is not there, it is not
   * an exception, or it is one the grouper has not reached yet. All three mean the same thing to
   * the reader pressing the key — there is no issue to open — and distinguishing them in the
   * status code would only invite the front to render three sentences for one shrug.
   */
  @Get("for-log/:id")
  async forLog(@Param("id") id: string, @Query() p: LogQueryDto): Promise<IssueDetail> {
    const { from, to } = parseWindow(p);

    const line = await this.logs.byId(parseRowId(id), from, to);
    if (line === null) throw new NotFoundException("no such log line in this range");

    const rows = await this.issues.around(line.service, line.ts, LOOKAROUND_MS);
    const fingerprint = fingerprintForLog(rows, line.id);
    if (fingerprint === null) throw new NotFoundException("this line is not part of a grouped error");

    return this.detail(fingerprint);
  }

  @Get()
  async list(@Query() p: IssueQueryDto): Promise<IssuePage> {
    const filters = parseFilters(p);
    const sort = parseSort(p.sort);
    const limit = parseLimit(p.limit);
    const cursor = resolveCursor(p);

    const startedAt = performance.now();
    // One row more than asked for, purely to learn whether another page exists — a `COUNT(*)` over
    // the same predicate would double the work to answer what the extra row answers free.
    const found = await this.issues.list(filters, sort, limit + 1, cursor);
    const hasMore = found.length > limit;
    const rows = found.slice(0, limit);

    // The window is anchored now and shared by every row, so the sparklines are comparable. It is
    // read after the list rather than before, so a slow page cannot leave the axis behind the
    // occurrences drawn on it.
    const to = new Date();
    const from = new Date(+to - SPARK_WINDOW_MS);
    const bucketMs = SPARK_WINDOW_MS / SPARK_BUCKETS;
    const spark = await this.issues.sparks(
      rows.map((row) => row.id),
      from,
      to,
      bucketMs,
    );
    const tookMs = Math.round(performance.now() - startedAt);

    const last = rows.at(-1);
    return {
      rows: rows.map((row) => toIssueRow(row, spark.get(row.id) ?? [])),
      // Cut from the last row of the page and from the column this sort ordered by — which is why
      // the token is opaque: handing it back with a different `sort` would compare a count against
      // a timestamp.
      nextCursor: hasMore && last ? encodeKeysetCursor(SORTS[sort].keyOf(last), last.id) : null,
      spark: { from: from.toISOString(), to: to.toISOString(), bucketMs },
      meta: { tookMs },
    };
  }

  /**
   * One issue in full, with its stack.
   *
   * A **404** for a fingerprint that is not there, unlike the log routes' unknown trace id, which
   * is an empty result. The difference is what the caller is claiming: a trace id is a question
   * that may have no answer, while a fingerprint came off a row it has already been shown.
   */
  @Get(":fingerprint")
  async detail(@Param("fingerprint") fingerprint: string): Promise<IssueDetail> {
    const row = await this.issues.byFingerprint(parseFingerprint(fingerprint));
    if (row === null) throw new NotFoundException("no such issue");

    const to = new Date();
    const from = new Date(+to - SPARK_WINDOW_MS);
    const spark = await this.issues.sparks([row.id], from, to, SPARK_WINDOW_MS / SPARK_BUCKETS);

    return toIssueDetail(row, spark.get(row.id) ?? []);
  }

  /**
   * The modal's chart. Finer than the row's sparkline on purpose: the same forty-eight hours, but
   * a chart with room for the resolution `chooseBucketMs` picks rather than 52 pixels of it.
   */
  @Get(":fingerprint/occurrences")
  async occurrences(
    @Param("fingerprint") fingerprint: string,
    @Query() p: OccurrenceQueryDto,
  ): Promise<OccurrenceSeries> {
    const id = await this.issues.idOf(parseFingerprint(fingerprint));
    if (id === null) throw new NotFoundException("no such issue");

    const { from, to } = parseOccurrenceWindow(p, Date.now());
    const bucketMs = chooseBucketMs(+from, +to);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bucketMs,
      counts: await this.issues.occurrences(id, from, to, bucketMs),
    };
  }

  /**
   * The three state changes.
   *
   * Three routes rather than one taking the status in a body: they are three distinct acts with
   * three distinct buttons, and a verb in the path is what makes a `curl` reproducing one of them
   * legible in a bug report. It also keeps the request body empty, so nothing here needs
   * validating beyond the fingerprint.
   */
  @Post(":fingerprint/resolve")
  resolve(@Param("fingerprint") fingerprint: string) {
    return this.move(fingerprint, "resolved");
  }

  @Post(":fingerprint/ignore")
  ignore(@Param("fingerprint") fingerprint: string) {
    return this.move(fingerprint, "ignored");
  }

  /** Reopening leaves `regression` alone — see `IssuesService.setStatus`. */
  @Post(":fingerprint/reopen")
  reopen(@Param("fingerprint") fingerprint: string) {
    return this.move(fingerprint, "unresolved");
  }

  private async move(fingerprint: string, status: "unresolved" | "resolved" | "ignored") {
    const found = await this.issues.setStatus(parseFingerprint(fingerprint), status);
    if (!found) throw new NotFoundException("no such issue");

    return { ok: true };
  }
}
