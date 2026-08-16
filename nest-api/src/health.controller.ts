import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator";

/**
 * The only public route.
 *
 * Liveness only, and deliberately empty of detail: no version, no dependency status, no
 * hostname. This endpoint answers from the public internet through nginx, so everything it
 * returns is something an unauthenticated stranger learns about the box.
 *
 * It also lives **outside** `/api` — the vhost routes `= /health` straight to this port, and it
 * is the URL Zeus's registry probes.
 *
 * `@Public()` is what exempts it from the global guard. Zeus's registry probes this URL with
 * no cookie, so a 401 here reads as the whole app being down.
 */
@Public()
@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok" };
  }
}
