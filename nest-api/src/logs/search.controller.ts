import { Controller, Get, Query } from "@nestjs/common";
import { LogQueryDto, parseWindow } from "./log-query";
import { SearchService } from "./search.service";

import type { SearchResults } from "@contracts/search";

/**
 * `GET /api/search?q=` — everything the ⌘K palette can jump to (IKN-22).
 *
 * Mounted at `/api/search` rather than under `/api/logs` because it is not a log query: two of its
 * three sources happen to live in `log_entry`, but what it returns are things to navigate to, and
 * the registry is not a log table at all.
 *
 * Behind the global session guard like everything else. The route names services, paths and trace
 * ids — a map of what runs on the host, which is not something to hand out unsigned-in.
 */
@Controller("api/search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async query(@Query() p: LogQueryDto): Promise<SearchResults> {
    // The same mandatory window as `GET /api/logs`, and for the same reason: two of the three
    // sources group over the partitioned table, and a missing range is a full scan of every day
    // ever retained. A forgotten parameter must be a loud 400, never a slow success.
    const { from, to } = parseWindow(p);
    const term = (p.q ?? "").trim();

    const startedAt = performance.now();
    const hits = await this.search.search(term, from, to);

    return { hits, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }
}
