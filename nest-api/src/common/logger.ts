import ecsFormat from "@elastic/ecs-pino-format";
import pino from "pino";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DestinationStream, LoggerOptions } from "pino";

/**
 * Printed on stderr when the database write path itself fails.
 *
 * The ingest parser (Task 13) skips any line containing it. Without that, a database outage
 * becomes an infinite loop: the write fails, the failure is logged, the log line is ingested,
 * the write of that line fails, and so on until the disk or the process gives out.
 */
export const INGEST_SKIP_MARKER = "IKNOS_SELF_ERR";

/**
 * Never in a log line, in any shape (IKN-30).
 *
 * The first version of this file had no redaction at all, and pino-http duly wrote every request
 * header into `attrs` — including `cookie: iknos.sid=…`, the session of the only account there
 * is. It reached production and was found by reading the table.
 *
 * Both spellings are listed because pino applies redaction **after** `formatters.log`: by then a
 * converted request is `http.request.headers`, and one that failed to convert is still `req`.
 * Covering one shape means the other publishes the credential.
 */
const REDACTED = [
  "http.request.headers.cookie",
  "http.request.headers.authorization",
  'http.response.headers["set-cookie"]',
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "*.password",
  "*.passphrase",
  "password",
  "passphrase",
];

/**
 * ECS measures durations in **nanoseconds**; pino-http reports `responseTime` in milliseconds.
 *
 * Left unconverted the number is present and no consumer reads it — including this project's own
 * parser, which divides `event.duration` by a million. Without this the recorded duration of every
 * Iknos request would be wrong by that same factor.
 */
function withEventDuration(options: LoggerOptions): LoggerOptions {
  const format = options.formatters?.log;

  return {
    ...options,
    formatters: {
      ...options.formatters,
      log(object: Record<string, unknown>): Record<string, unknown> {
        const out = format ? format(object) : object;
        if (typeof out.responseTime === "number") {
          out["event.duration"] = Math.round(out.responseTime * 1_000_000);
          delete out.responseTime;
        }
        return out;
      },
    },
  };
}

/**
 * The same emitter IKN-1 puts into PFA: pino with `@elastic/ecs-pino-format`.
 *
 * That is the whole point of the founding principle — Iknos writes ECS NDJSON to stdout exactly
 * like every application it watches, so it is monitored by its own pipeline with no special
 * casing, and swapping Iknos for Loki later changes nothing about how anything logs.
 */
export function buildLogger(level: string, dest?: DestinationStream) {
  return pino(
    {
      level,
      ...withEventDuration(ecsFormat({ serviceName: "iknos", convertReqRes: true })),
      redact: { paths: REDACTED, censor: "[redacted]" },
    },
    dest,
  );
}

export const logger = buildLogger(process.env.IKNOS_LOG_LEVEL ?? "info");

/**
 * The request half of the access line, and the reason it is written by hand.
 *
 * `convertReqRes` handles the response but never sees the request: pino-http binds `req` into a
 * child logger through `pino-std-serializers`, which flattens it into a shape the ECS formatter's
 * duck-typing rejects — no `httpVersion`, therefore not an HTTP request, therefore silence. Every
 * access line Iknos wrote before IKN-30 had a status code and nothing else: no method, no path,
 * no client address, so its own logs were the one service in the fleet nobody could filter.
 *
 * `customProps` receives the raw objects, so the fields are simply built here.
 */
export const httpLoggerOptions = {
  wrapSerializers: false,
  serializers: {
    /**
     * The request never reaches the line, and that is the security half of IKN-30.
     *
     * With `wrapSerializers: false` and no serializer here, pino walks the raw `IncomingMessage`
     * and publishes the socket, its parser and `rawHeaders` — cookie included, several times over
     * through the object graph. Everything worth keeping is in `customProps` below.
     */
    req: () => undefined,
    res: (res: ServerResponse) => res,
  },

  customProps(req: IncomingMessage): Record<string, string | undefined> {
    const request = req as IncomingMessage & {
      originalUrl?: string;
      ip?: string;
      session?: { userId?: number };
    };
    const url = request.originalUrl ?? request.url ?? "";
    const [path, query] = url.split("?");

    return {
      "http.request.method": request.method,
      "url.path": path,
      "url.query": query,
      // Real only because main.ts trusts the proxy; without that every caller is 127.0.0.1.
      "client.ip": request.ip ?? request.socket?.remoteAddress,
      "user_agent.original": request.headers["user-agent"],
      "user.id": request.session?.userId?.toString(),
    };
  },
};
