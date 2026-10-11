import { availableParallelism } from "node:os";
import { DISK_CRITICAL_PCT, DISK_WARN_PCT } from "@alerts/thresholds";
import { HOST_LABEL } from "@config/host-label";
import { parseWindow } from "@logs/log-query";
import { Controller, Get, Inject, Query } from "@nestjs/common";
import { HostService } from "./host.service";
import { overallLevel } from "./host-series";
import { SignalsQueryDto } from "./service-view.controller";

import type { HostNow, HostSeries, HostThresholds } from "@contracts/host";

/** The disk rule's two lines, as every host response carries them. */
const DISK_THRESHOLDS: HostThresholds = { warnPct: DISK_WARN_PCT, criticalPct: DISK_CRITICAL_PCT };

/**
 * The machine behind the host badge (IKN-25), under the name the badge shows (IKN-65).
 *
 * Behind the global session guard like every route but `/health` — no `@Public()` here. How full
 * the disk is and how loaded the box is are a map of where it would hurt, and nobody's business
 * unsigned-in.
 */
@Controller("api/host")
export class HostController {
  constructor(
    private readonly host: HostService,
    @Inject(HOST_LABEL) private readonly label: string,
  ) {}

  /** The badge's poll: the newest sample and its level. One indexed row. */
  @Get("now")
  async now(): Promise<HostNow> {
    const startedAt = performance.now();
    const reading = await this.host.now(availableParallelism());

    return {
      host: this.label,
      reading,
      level: overallLevel(reading),
      thresholds: DISK_THRESHOLDS,
      observedAt: new Date().toISOString(),
      meta: { tookMs: Math.round(performance.now() - startedAt) },
    };
  }

  /** CPU, memory, disk and load over the range the top bar is showing. */
  @Get("series")
  async series(@Query() query: SignalsQueryDto): Promise<HostSeries> {
    const { from, to } = parseWindow(query);
    const startedAt = performance.now();
    const points = await this.host.series({ from, to });

    return {
      host: this.label,
      from: from.toISOString(),
      to: to.toISOString(),
      ...points,
      thresholds: DISK_THRESHOLDS,
      meta: { tookMs: Math.round(performance.now() - startedAt) },
    };
  }
}
