import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";

import type { SpanRecord } from "./interfaces/otlp-types";

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
 */
@Injectable()
export class SpanWriter {
  constructor(private readonly prisma: PrismaService) {}

  /** How many rows were new — fewer than `spans.length` when a batch is a resend. */
  async write(spans: SpanRecord[]): Promise<number> {
    if (spans.length === 0) return 0;

    const { count } = await this.prisma.span.createMany({
      data: spans.map((span) => ({ ...span, attrs: span.attrs ?? undefined })),
      skipDuplicates: true,
    });
    return count;
  }
}
