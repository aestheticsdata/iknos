import { ABSENT } from "@lib/serviceFormat";

import type { Tone } from "@components/ui/surface";
import type { IssueRow } from "@lib/issueTypes";

/**
 * The arithmetic the issues surfaces do at render time (IKN-14).
 *
 * Out here rather than in the components, for the reason `serviceFormat.ts` gives: these are the
 * decisions that would be wrong in silence. A dot one tier too calm, an age that rounds `23h` to
 * `1d`, a message line that loses the file it happened in — none of them fails, and all of them are
 * read as facts.
 */

/**
 * The severity dot's tiers, **by recency** — the mockup shows four tones and names none of them.
 *
 * Volume was the other candidate and is wrong for this surface. The rail panel is four rows sorted
 * by last-seen, and on a bad day all four have large counts: a volume scale paints them one colour
 * exactly when the reader most needs to tell them apart. The count is already on the row in
 * figures. What the dot adds is the thing figures cannot say at a glance — *is this happening now*.
 *
 * Exported so the panel, the table and the modal cannot come to disagree about the same issue —
 * the reason `service-rail.ts` exports `STALE_AFTER_MS` rather than inlining it twice.
 */
export const RECENCY_MS: { tone: Tone; within: number }[] = [
  { tone: "error", within: 15 * 60_000 },
  { tone: "warn", within: 60 * 60_000 },
  { tone: "info", within: 24 * 60 * 60_000 },
];

/** Beyond the last tier. Not "fine" — only "not today". */
const COLD: Tone = "ok";

export const recencyTone = (lastSeen: string, now: number = Date.now()): Tone => {
  const at = Date.parse(lastSeen);
  // An unparseable timestamp is not a fresh one. Cold is the tier that claims least.
  if (Number.isNaN(at)) return COLD;

  const age = now - at;
  return RECENCY_MS.find((tier) => age < tier.within)?.tone ?? COLD;
};

/**
 * Whether the row carries the error ground — the mockup's "hot" issue.
 *
 * The top tier alone, and it is deliberately the same threshold the dot uses rather than a second
 * one: a row painted hot with a warn dot on it would be saying two things about one issue.
 */
export const isHot = (row: IssueRow, now: number = Date.now()): boolean => recencyTone(row.lastSeen, now) === "error";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `2m ago`, `14m ago`, `6h ago`, `3d ago` — the mockup's own spelling.
 *
 * Never seconds: this is read off a list of issues, where "40s ago" and "1m ago" mean the same
 * thing to the reader and only one of them stops changing while they look at it. Never more than
 * one unit either — `2d 4h ago` is a duration, and what the column is asked for is a distance.
 *
 * Days rather than hours past a day, unlike `formatLag`: an issue last seen five days ago reads as
 * `5d`, where `120h` is a number the reader has to divide.
 */
export const formatAgo = (iso: string, now: number = Date.now()): string => {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return ABSENT;

  // A timestamp in the future is a clock that disagrees, not a negative age. Clamped, because the
  // issue did happen and `now` is the nearest true thing to say about it.
  const age = Math.max(0, now - at);

  if (age < MINUTE) return "now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  return `${Math.floor(age / DAY)}d ago`;
};

/**
 * The eight characters the mockup prints in the chip.
 *
 * Half of a sixteen-character hash, which is a fingerprint the reader recognises across a session
 * rather than one they could verify. The full value is on the row's `title` and in the URL, which
 * is where a value that has to be exact belongs.
 */
export const SHORT_FINGERPRINT = 8;

export const shortFingerprint = (fingerprint: string): string => fingerprint.slice(0, SHORT_FINGERPRINT);

/**
 * `pool timeout after 8000ms · src/queue/export.ts:142` — the message and where it happened.
 *
 * One line rather than two fields, because the pair is what identifies an error without opening it
 * and neither half does it alone: a hundred `TypeError`s share a message and differ by file. The
 * separator is the mockup's, and the culprit is simply omitted when every frame belonged to a
 * dependency — a ` · ` with nothing after it reads as a rendering fault.
 */
export const issueLine = (row: Pick<IssueRow, "message" | "culprit">): string => {
  // The first line only: a message can be a whole serialised error, and the rest of it belongs in
  // the modal's stack pane rather than clamped into two lines of a rail.
  const message = row.message.split("\n")[0].trim();
  return row.culprit === null ? message : `${message} · ${row.culprit}`;
};

/**
 * The type, or the fallback for an exception that carried none.
 *
 * The mockup's row leads with the type in every state, so there has to be something to lead with.
 * The message is the honest substitute — it is what the reader would have called the error anyway.
 */
export const issueTitle = (row: Pick<IssueRow, "type" | "message">): string =>
  row.type ?? row.message.split("\n")[0].trim();

/** The release column, which shows `—` until a deploy writes a marker the collector can read. */
export const formatRelease = (release: string | null): string => release ?? ABSENT;
