import type { LogRow } from "./log-row";

/**
 * One log line in full — what `GET /api/logs/entry/:id` answers, and the only place `attrs`
 * crosses the wire.
 *
 * This is the other half of the decision argued in `log-row.ts`. The list payload stops at
 * `LogRow` because two hundred rows of arbitrary JSON is a cost every page pays for a field that
 * is only ever read one row at a time; so the three columns the list leaves behind are fetched for
 * the one row that was opened, and for no other.
 *
 * Not a separate shape but a widening of `LogRow`, deliberately: the detail of a row must be that
 * row plus more, never that row rendered slightly differently, or the expanded pane and the line
 * above it could disagree about what happened.
 */
export type LogDetail = LogRow & {
  userId: string | null;
  hostname: string | null;
  /**
   * Everything the columns do not claim, exactly as the service logged it and under the keys it
   * used. ECS keys stay dotted: `attrs["user_agent.original"]` is a key, not a path.
   */
  attrs: Record<string, unknown> | null;
};
