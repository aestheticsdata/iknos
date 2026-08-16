import { Controller, Get } from "@nestjs/common";

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
 * Task 9 adds `@Public()` here, once the global session guard exists to need it.
 */
@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok" };
  }
}
