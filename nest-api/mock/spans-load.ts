import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_SPANS_PER_REQUEST } from "@otlp/otlp-limits";
import { parseTraces } from "@otlp/otlp-parse";
import { SpanWriter } from "@otlp/span-writer.service";

import type { PrismaService } from "@db/prisma.service";
import type { CorpusAttr, CorpusService, CorpusSpan, SpanLoadResult } from "./interfaces/spanCorpusTypes";

/**
 * Loads `mock/spans.json` (IKN-90) the way an Officina app would send it: each batch is expanded
 * back into an OTLP/JSON request, parsed by the real `parseTraces` with the service as the token
 * would grant it, and written by the real `SpanWriter`. A span the production parser would refuse
 * is refused here too, and counted.
 */

/** The corpus spans fourteen days; one more so a run straddling the edge is not cut. */
const MAX_AGE_DAYS = 15;

/** What Officina states on every batch: how long its `full` content may be kept (its own default). */
const CONTENT_RETENTION_DAYS = 7;

function otlpValue(value: CorpusAttr) {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
}

const otlpAttributes = (attrs: Record<string, CorpusAttr>) =>
  Object.entries(attrs).map(([key, value]) => ({ key, value: otlpValue(value) }));

const nanos = (ms: number, delta: number): string => `${BigInt(Math.round(ms + delta)) * 1_000_000n}`;

type Batch = {
  traceId: string;
  span: CorpusSpan;
};

function otlpRequest(batch: Batch[], delta: number) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "officina.content.retention_days", value: { intValue: String(CONTENT_RETENTION_DAYS) } }],
        },
        scopeSpans: [
          {
            scope: { name: "@officina/trace" },
            spans: batch.map(({ traceId, span }) => {
              const [spanId, parentSpanId, name, startMs, endMs, code, attrs, events] = span;
              return {
                traceId,
                spanId,
                ...(parentSpanId ? { parentSpanId } : {}),
                name,
                kind: 1,
                startTimeUnixNano: nanos(startMs, delta),
                endTimeUnixNano: nanos(endMs, delta),
                attributes: otlpAttributes(attrs),
                ...(events.length > 0
                  ? {
                      events: events.map(([timeMs, eventName, eventAttrs]) => ({
                        timeUnixNano: nanos(timeMs, delta),
                        name: eventName,
                        attributes: otlpAttributes(eventAttrs),
                      })),
                    }
                  : {}),
                status: { code },
              };
            }),
          },
        ],
      },
    ],
  };
}

/** Writes every run of the corpus, shifted by `delta` ms. Returns how many spans landed and how many were refused. */
export async function loadSpans(db: PrismaService, mockDir: string, delta: number): Promise<SpanLoadResult> {
  const corpus = JSON.parse(readFileSync(join(mockDir, "spans.json"), "utf8")) as CorpusService[];
  const writer = new SpanWriter(db);
  const now = new Date();
  let stored = 0;
  let rejected = 0;

  for (const entry of corpus) {
    const all: Batch[] = entry.runs.flatMap((run) => run.spans.map((span) => ({ traceId: run.traceId, span })));
    for (let i = 0; i < all.length; i += MAX_SPANS_PER_REQUEST) {
      const outcome = parseTraces(otlpRequest(all.slice(i, i + MAX_SPANS_PER_REQUEST), delta), {
        service: entry.service,
        now,
        maxAgeDays: MAX_AGE_DAYS,
        contentMaxDays: CONTENT_RETENTION_DAYS,
      });
      rejected += outcome.rejected;
      stored += await writer.write(outcome);
    }
  }
  return { stored, rejected };
}
