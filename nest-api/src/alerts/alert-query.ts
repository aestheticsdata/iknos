import { decodeKeysetCursor } from "@common/keyset-cursor";
import { Prisma } from "@generated/prisma/client";
import { BadRequestException } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { SEVERITIES } from "./rule";

import type { Severity } from "@contracts/alert-row";

/**
 * The alerts list's vocabulary, parsed once (IKN-15).
 *
 * No time range required, for the reason `issue-query.ts` gives: `alert` is unpartitioned and holds
 * one row per episode, and bounding it by time would hide the alert whose whole point is that it
 * has been open since Tuesday.
 */

export class AlertQueryDto {
  /** `open` (default) | `acked` | `resolved` | `all`. */
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() severity?: string;
  @IsOptional() @IsString() service?: string;
  @IsOptional() @IsString() rule?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @IsString() limit?: string;
}

export const VIEWS = ["open", "acked", "resolved", "all"] as const;
export type AlertView = (typeof VIEWS)[number];

export type AlertFilters = {
  view: AlertView;
  severity?: Severity;
  service?: string;
  rule?: string;
};

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

/**
 * Strict, like `parseStatus` and unlike `parseSort`: an unrecognised view would quietly widen the
 * list while the segment above it claims to be narrowing. A filter that does not filter is the one
 * failure a triage list cannot afford.
 */
export function parseView(raw: string | undefined): AlertView {
  if (!raw) return "open";
  if (!VIEWS.includes(raw as AlertView)) throw new BadRequestException(`'state' must be one of: ${VIEWS.join(", ")}`);
  return raw as AlertView;
}

export function parseSeverity(raw: string | undefined): Severity | undefined {
  if (!raw) return undefined;
  if (!SEVERITIES.includes(raw as Severity)) {
    throw new BadRequestException(`'severity' must be one of: ${SEVERITIES.join(", ")}`);
  }
  return raw as Severity;
}

export function parseFilters(p: AlertQueryDto): AlertFilters {
  return {
    view: parseView(p.state),
    severity: parseSeverity(p.severity),
    // `|| undefined`, never `??`: an empty parameter is a filter the UI cleared.
    service: p.service || undefined,
    rule: p.rule || undefined,
  };
}

export function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new BadRequestException("'limit' must be an integer");
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/** An alert id off the URL. Digits only — an id nobody could have is a malformed request. */
export function parseAlertId(raw: string): number {
  if (!/^\d{1,10}$/.test(raw)) throw new BadRequestException("'id' must be an alert id");
  return Number(raw);
}

/**
 * What "needs attention" means, in one fragment — and it is used in three places, which is the
 * reason it is a function and not three copies.
 *
 * Firing, not acknowledged, not currently silenced. The rail badge, the status bar and the default
 * segment all ask this question, and IKN-15 requires the first two to agree; the surest way to
 * make them agree is for there to be one predicate.
 *
 * `pending` is excluded on purpose: the `for` window exists so that a condition which has not yet
 * persisted does not interrupt anybody.
 */
export const needsAttention = (now: Date): Prisma.Sql => Prisma.sql`
  resolved_at IS NULL
    AND state = 'firing'
    AND acked_at IS NULL
    AND (silenced_until IS NULL OR silenced_until <= ${now})`;

export function whereClause(f: AlertFilters, now: Date, cursor?: { key: number; id: number }): Prisma.Sql {
  const parts: Prisma.Sql[] = [];

  switch (f.view) {
    case "open":
      parts.push(needsAttention(now));
      break;
    case "acked":
      // Acknowledged *or* silenced: both mean "still true, deliberately out of the way", and the
      // ticket's own segment is one control, not two.
      parts.push(
        Prisma.sql`resolved_at IS NULL AND (acked_at IS NOT NULL OR (silenced_until IS NOT NULL AND silenced_until > ${now}))`,
      );
      break;
    case "resolved":
      parts.push(Prisma.sql`resolved_at IS NOT NULL`);
      break;
    case "all":
      break;
  }

  if (f.severity !== undefined) parts.push(Prisma.sql`severity = ${f.severity}`);
  if (f.service !== undefined) parts.push(Prisma.sql`service = ${f.service}`);
  if (f.rule !== undefined) parts.push(Prisma.sql`rule_key = ${f.rule}`);

  if (cursor !== undefined) {
    parts.push(Prisma.sql`(last_seen_at, id) < (${new Date(cursor.key)}, ${cursor.id})`);
  }

  return parts.length === 0 ? Prisma.sql`TRUE` : Prisma.join(parts, " AND ");
}

export function resolveCursor(p: AlertQueryDto): { key: number; id: number } | undefined {
  return p.cursor ? (decodeKeysetCursor(p.cursor) ?? undefined) : undefined;
}
