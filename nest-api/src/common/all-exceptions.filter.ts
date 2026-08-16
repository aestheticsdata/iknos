import { Catch, HttpException } from "@nestjs/common";

import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";

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

    // Anything else is unplanned. The client learns nothing; the logs learn all.
    this.logger.error({ err: exception, url: req?.url, method: req?.method }, "unhandled exception");
    res.status(500).json({ error: "internal error" });
  }
}
