import { PrismaService } from "@db/prisma.service";
import { BadRequestException, Injectable } from "@nestjs/common";
import { TRACE_ID } from "./log-query";
import { ROW_COLUMNS, toLogRow } from "./row";

import type { LogRow } from "@contracts/log-row";
import type { RawLogRow } from "./row";

/**
 * Every line that carried the same `trace.id`, in the order it was written.
 *
 * This is not distributed tracing and the response is careful never to imply that it is (backend
 * spec §11). There are no spans and no parent links — only the lines the services happened to
 * log, which is a weaker claim and an honest one.
 */

/** A request that logged more than this is not a timeline anyone reads; it is a loop. */
const MAX_TRACE_ROWS = 500;

@Injectable()
export class TraceService {
  constructor(private readonly prisma: PrismaService) {}

  async byTraceId(
    traceId: string,
    from: Date,
    to: Date,
  ): Promise<{ rows: LogRow[]; totalMs: number; truncated: boolean }> {
    if (!TRACE_ID.test(traceId)) throw new BadRequestException("malformed trace id");

    // One row over the cap, so the response can say it was cut rather than present five hundred
    // lines as the whole story. A silent limit on a timeline is a lie about what happened.
    const raw = await this.prisma.$queryRaw<RawLogRow[]>`
      SELECT ${ROW_COLUMNS}
        FROM log_entry
       WHERE trace_id = ${traceId} AND ts >= ${from} AND ts < ${to}
       ORDER BY ts ASC, id ASC
       LIMIT ${MAX_TRACE_ROWS + 1}`;

    const truncated = raw.length > MAX_TRACE_ROWS;
    const rows = truncated ? raw.slice(0, MAX_TRACE_ROWS) : raw;

    return { rows: rows.map(toLogRow), totalMs: totalMs(rows), truncated };
  }
}

/**
 * First line to last line, plus whatever the last line said it had taken.
 *
 * The wall-clock length of the request as the logs recorded it — an approximation bounded by how
 * often the services chose to log, and it is presented as nothing more.
 */
function totalMs(rows: RawLogRow[]): number {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return 0;

  return +last.ts - +first.ts + (last.durationMs ?? 0);
}
