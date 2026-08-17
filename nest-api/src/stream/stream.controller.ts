import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import { LogQueryDto, parseFilters } from "../logs/log-query";
import { LogBus } from "./log-bus";

import type { Request, Response } from "express";
import type { LogRow } from "../contracts/log-row";
import type { LogRecord } from "../ingest/log-record";
import type { LogFilters } from "../logs/log-query";

/**
 * The live tail.
 *
 * Written against the raw response rather than Nest's `@Sse()` decorator. `@Sse()` is tidier, but
 * it hands back an observable and no access to the socket's buffered length — and without that
 * the requirement below ("a slow subscriber must not retain memory") can only be hoped for, not
 * met.
 *
 * No database is involved. Rows come off `LogBus`, which the writer publishes to after each
 * transaction commits, so a line reaches the browser at the speed of an `EventEmitter` rather
 * than of a polling loop.
 */

/**
 * Once this much data is queued for one client, that client is not keeping up.
 *
 * Drop, never buffer. A tab left open in the background must not be able to retain memory in the
 * API process, and must never exert backpressure on ingestion — the collector's job is to not
 * lose log lines, and it does not get to be slowed down by somebody's forgotten window.
 */
const MAX_PENDING_BYTES = 256 * 1024;

/** nginx closes an idle upstream connection; a comment line every fifteen seconds keeps it open. */
const HEARTBEAT_MS = 15_000;

@Controller("api/logs")
export class StreamController {
  constructor(private readonly bus: LogBus) {}

  @Get("stream")
  stream(@Query() p: LogQueryDto, @Req() req: Request, @Res() res: Response): void {
    // Parsed before a single byte is written, so a bad request is still an ordinary 400 with a
    // JSON body rather than an error event inside a stream that already claimed success.
    //
    // `from` and `to` are required here as everywhere else, for one reason: the front builds one
    // query string and points it at both routes. See `withinWindow` for what is actually applied.
    const filters = parseFilters(p);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Belt and braces with nginx's `proxy_buffering off` (IKN-4). Without one or the other the
      // "live" tail arrives in bursts every few seconds, which is worse than no tail at all
      // because it looks like the system went quiet.
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");

    let dropped = 0;

    const unsubscribe = this.bus.subscribe((record) => {
      if (!matches(record, filters)) return;

      if (res.writableLength > MAX_PENDING_BYTES) {
        dropped += 1;
        return;
      }
      if (dropped > 0) {
        // Tell the client it has a hole so the view can draw a gap marker. A tail that silently
        // skips lines is worse than one that admits it, because it looks continuous.
        res.write(`event: lagged\ndata: ${dropped}\n\n`);
        dropped = 0;
      }

      res.write(`event: log\ndata: ${JSON.stringify(toRow(record))}\n\n`);
    });

    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    // The socket already keeps the process alive; this timer should not be the thing that does.
    heartbeat.unref();

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}

/**
 * The same `LogRow` the search returns, so the view has one row renderer.
 *
 * `id` is empty: this line has been committed, but the stream never read it back and so does not
 * know its autoincrement value. The client keys live rows on `ts` + `message` until they are
 * replaced by a real page.
 */
function toRow(r: LogRecord): LogRow {
  return {
    id: "",
    ts: r.ts.toISOString(),
    service: r.service,
    level: r.level,
    levelName: r.levelName,
    message: r.message,
    traceId: r.traceId,
    httpMethod: r.httpMethod,
    route: r.route,
    statusCode: r.statusCode,
    durationMs: r.durationMs,
  };
}

/**
 * The search's filters, applied in memory to a record that has not been through SQL.
 *
 * `q` is compared case-insensitively because the column's collation is `utf8mb4_unicode_ci` and
 * the `LIKE` in the search therefore is too. A tail that matched case-sensitively would quietly
 * disagree with the list above it.
 */
function matches(r: LogRecord, f: LogFilters): boolean {
  if (f.service !== undefined && r.service !== f.service) return false;
  if (f.minLevel !== undefined && r.level < f.minLevel) return false;
  if (f.route !== undefined && r.route !== f.route) return false;
  if (f.statusCode !== undefined && r.statusCode !== f.statusCode) return false;
  if (f.q !== undefined && !r.message.toLowerCase().includes(f.q.toLowerCase())) return false;

  return withinWindow(r, f);
}

/**
 * Only `from` is applied, and `to` deliberately is not.
 *
 * A live tail is a stream of what happens next, so a `to` taken from the search bar is in the
 * past by the time the first line arrives — honouring it would mean the tail silently emits
 * nothing, which reads exactly like a system that has gone quiet. `from` stays meaningful: the
 * collector can be catching up on a file with old lines in it, and "not older than my window"
 * is a real thing to ask for.
 */
function withinWindow(r: LogRecord, f: LogFilters): boolean {
  return r.ts >= f.from;
}
