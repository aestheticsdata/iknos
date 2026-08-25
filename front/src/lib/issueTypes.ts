/**
 * What the issue routes return, restated — the authoritative copies are
 * `nest-api/src/contracts/issue-*.ts`, like every other contract in this front end.
 *
 * The duplication is deliberate and is explained once, in `contracts/index.ts`: the two halves are
 * independent pnpm roots with their own lockfiles, so neither can break the other's build. When a
 * field changes there, it changes here.
 */

import type { Meta } from "@lib/logTypes";

/** The three filter segments. A regression is a flag on an `unresolved` issue, not a fourth state. */
export type IssueStatus = "unresolved" | "resolved" | "ignored";

/** The sorts the list offers, matching the API's own vocabulary one for one. */
export const ISSUE_SORTS = ["last", "volume", "first"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

export type IssueRow = {
  /** Sixteen hex characters — the public identifier, and what every route and URL is keyed on. */
  fingerprint: string;
  service: string;
  type: string | null;
  message: string;
  culprit: string | null;
  level: number;
  levelName: string;
  status: IssueStatus;
  regression: boolean;
  /** ISO-8601, UTC. */
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  firstRelease: string | null;
  lastRelease: string | null;
  /** Occurrences per bucket over `IssuePage.spark`, oldest first. Never sparse — a gap is a zero. */
  spark: number[];
};

export type IssuePage = {
  rows: IssueRow[];
  nextCursor: string | null;
  /** The axis every row's `spark` is drawn on — one window for the page, chosen by the server. */
  spark: { from: string; to: string; bucketMs: number };
  meta: Meta;
};

export type IssueCounts = Record<IssueStatus, number>;

export type IssueDetail = IssueRow & {
  latest: { ts: string; traceId: string | null; stack: string | null } | null;
};

export type OccurrenceSeries = {
  from: string;
  to: string;
  bucketMs: number;
  counts: number[];
};
