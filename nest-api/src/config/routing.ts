import type { NestApplicationOptions } from "@nestjs/common";

/**
 * How routes are registered and checked (IKN-80), shared by `main.ts` and the e2e app, so the suites
 * register routes exactly as production does.
 *
 * - `specificity`: literal segments are registered before parametric ones, so a literal route never
 *   depends on being declared before its `:id` neighbour.
 * - A duplicate route (same method and path twice) stops the boot.
 * - Shadows are not reported: the detector ignores the strategy and flags the overlaps it resolves
 *   on purpose — `counts` and `for-log/:id` beside `/api/issues/:fingerprint` (a 16-character
 *   fingerprint), `counts` beside `/api/alerts/:id` (an integer).
 */
export const ROUTING_OPTIONS = {
  routeResolutionStrategy: "specificity",
  routeConflictPolicy: { duplicate: "error", shadow: "off" },
} as const satisfies NestApplicationOptions;
