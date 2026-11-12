import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";

import type { ParsedBatch } from "./interfaces/otlp-types";

/**
 * Writes parsed spans, straight through (IKN-87).
 *
 * Not queued, for the reason `HttpIngestService` gives: the sender is still waiting for the answer,
 * so a database failure should reach it as a 5xx it can retry — OTLP exporters do retry — rather
 * than as a 200 for spans the API never stored.
 *
 * `skipDuplicates` (MySQL's `INSERT IGNORE`) against the `(trace_id, span_id, ts)` key is what makes
 * that retry harmless. Every value has already been bounded by the parser, so the warnings `IGNORE`
 * would otherwise downgrade (a truncated string, an out-of-range number) cannot occur.
 *
 * Since IKN-87 v2 a batch is three tables — spans, their events, and the content taken out of both —
 * written in one transaction, so a failure leaves none of them half-written. Each has its own
 * resend key (`span_event`'s event index, `span_content`'s owner and key), so a retry is still one
 * row per thing. A resent span keeps the `content_until` of its first copy, as its content rows keep
 * their first `expires_at`: the first write wins on every table alike.
 */
@Injectable()
export class SpanWriter {
  constructor(private readonly prisma: PrismaService) {}

  /** How many rows were new — fewer than `spans.length` when a batch is a resend. */
  async write(batch: ParsedBatch): Promise<number> {
    const { spans, events, contents } = batch;
    if (spans.length === 0) return 0;

    const [{ count }] = await this.prisma.$transaction([
      this.prisma.span.createMany({
        data: spans.map((span) => ({ ...span, attrs: span.attrs ?? undefined })),
        skipDuplicates: true,
      }),
      this.prisma.spanEvent.createMany({
        data: events.map((event) => ({ ...event, attrs: event.attrs ?? undefined })),
        skipDuplicates: true,
      }),
      this.prisma.spanContent.createMany({ data: contents, skipDuplicates: true }),
    ]);
    return count;
  }
}
