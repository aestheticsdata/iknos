import { parseWindow } from "@logs/log-query";
import { BadRequestException } from "@nestjs/common";

import type { CollectorProgress, SliQuery, SliQueryInput } from "./interfaces/sli-types";

/**
 * Zeus asks for 30 minutes before a deploy and 10 after. A day is room to spare, and the bound
 * keeps a mistyped `from` from turning one call into a scan of the whole retention.
 */
export const MAX_SLI_SPAN_MS = 24 * 60 * 60 * 1000;

/** `route` is `VARCHAR(255)`; a longer prefix could never match anything. */
const MAX_PREFIX_LENGTH = 255;

/** A path, and nothing that could be read as something else. */
const PREFIX = /^\/[A-Za-z0-9._~\-/]*$/;

/**
 * `/api/` and `/api` mean the same subtree, so the trailing slash goes. A bare `/` would be "every
 * route", which is what leaving the parameter out already says — it is refused rather than given a
 * second spelling.
 */
function toPrefix(name: string, raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  if (raw.length > MAX_PREFIX_LENGTH || !PREFIX.test(raw)) {
    throw new BadRequestException(`'${name}' must be a path such as /api`);
  }
  const trimmed = raw.replace(/\/+$/, "");
  if (trimmed === "") throw new BadRequestException(`'${name}' must not be / — leave it out to mean every route`);
  return trimmed;
}

export function toSliQuery(input: SliQueryInput): SliQuery {
  if (!input.service) throw new BadRequestException("'service' is required");

  const { from, to } = parseWindow(input);
  if (to.getTime() - from.getTime() > MAX_SLI_SPAN_MS) {
    throw new BadRequestException("the window must be at most 24 hours");
  }

  const pathPrefix = toPrefix("pathPrefix", input.pathPrefix);
  const excludePathPrefix = toPrefix("excludePathPrefix", input.excludePathPrefix);
  if (pathPrefix !== null && pathPrefix === excludePathPrefix) {
    throw new BadRequestException("'pathPrefix' and 'excludePathPrefix' cancel each other out");
  }

  return { service: input.service, from, to, pathPrefix, excludePathPrefix };
}

/**
 * `LIKE` treats `%` and `_` as wildcards and `\` as their escape. `PREFIX` already refuses `%` and
 * `\`, but `_` is a perfectly ordinary character in a path and has to be taken literally.
 */
export const likeSubtree = (prefix: string): string => `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;

/**
 * Where the 95th percentile sits in `timed` values sorted ascending — nearest rank, so the answer
 * is always a duration that was actually measured, never an interpolation between two of them.
 * `null` when there is nothing to rank.
 */
export function p95Offset(timed: number): number | null {
  if (timed <= 0) return null;
  return Math.ceil(timed * 0.95) - 1;
}

/**
 * The moment up to which every access line is already in `log_entry`.
 *
 * A pass reads each file to its end and hands the lines to the writer, which commits them on its
 * own interval. With nothing queued, everything the last pass read is stored, so the pass's own
 * time is the answer. With lines still queued, only what the last committed batch held is certain,
 * and that is the older of the two — the safe side to be wrong on, because Zeus then waits or calls
 * the check impossible, and never validates a deploy on lines it has not seen.
 */
export function ingestedThrough(progress: CollectorProgress): Date | null {
  if (progress.lastPollAt === null) return null;
  if (progress.queued === 0) return progress.lastPollAt;
  if (progress.lastWrittenAt === null) return null;
  return progress.lastWrittenAt < progress.lastPollAt ? progress.lastWrittenAt : progress.lastPollAt;
}
