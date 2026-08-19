import { Catch, HttpException } from "@nestjs/common";

import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";

/**
 * Failures raised by Express middleware rather than by a controller.
 *
 * The body parser runs before Nest's router, so what it throws is a plain `Error` and falls to
 * the last branch of `catch`, the one meant for bugs — answering 500 to a request the server
 * refused perfectly correctly, and logging a stack trace for it. Both are lies about what
 * happened.
 *
 * The message is written here and not taken from the error: `entity.parse.failed` quotes the
 * offending body in its own, which is precisely the kind of echo this filter exists to stop.
 */
const MIDDLEWARE_ERRORS: Record<string, { status: number; error: string }> = {
  "entity.too.large": { status: 413, error: "request body too large" },
  "entity.parse.failed": { status: 400, error: "malformed JSON body" },
};

/**
 * The one place an unhandled error becomes a response.
 *
 * The rule it enforces: **the body sent to the client never contains internal detail** — no SQL
 * text, no file paths, no hostnames. A monitoring console exposed on the internet that echoes
 * its Prisma errors is an information leak, and the errors it would echo are about the database
 * holding every log line on the box.
 *
 * The detail is not discarded, it is redirected. Everything goes to the logger, which is Iknos'
 * own ECS emitter, which means an unhandled exception here shows up in Iknos' own Logs view.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: { error: (obj: unknown, msg?: string) => void }) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse();
    const req = http.getRequest();

    if (exception instanceof HttpException) {
      // A deliberate client error. Its message is one we wrote for the client to read, so it is
      // safe to send — and it is not logged at error level, because a 400 is the API working
      // and logging it would bury the 500s that are not.
      const status = exception.getStatus();
      const payload = exception.getResponse();
      res.status(status).json(typeof payload === "string" ? { error: payload } : payload);
      return;
    }

    const type = (exception as { type?: unknown } | null | undefined)?.type;
    const known = typeof type === "string" ? MIDDLEWARE_ERRORS[type] : undefined;
    if (known) {
      // A client error like any other, so not logged at error level either.
      res.status(known.status).json({ error: known.error });
      return;
    }

    // Anything else is unplanned. The client learns nothing; the logs learn all.
    this.logger.error({ err: exception, url: req?.url, method: req?.method }, "unhandled exception");
    res.status(500).json({ error: "internal error" });
  }
}
