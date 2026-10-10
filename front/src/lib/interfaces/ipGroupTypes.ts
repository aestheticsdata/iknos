/**
 * What `GET /api/logs/ips` returns, restated — the authoritative copy is
 * `nest-api/src/contracts/ip-groups.ts`, like every other contract in this front end (IKN-72).
 */

import type { Meta } from "@lib/logTypes";

/** Mirrors `contracts/ip-groups.ts`. Many routes on one address is the shape of a scan. */
export type IpGroup = {
  ip: string;
  hits: number;
  /** Distinct routes the address hit. */
  routes: number;
  /** ISO-8601, UTC. */
  lastSeen: string;
};

/** Mirrors `contracts/ip-groups.ts`. Busiest first, capped; `truncated` says the cap cut it. */
export type IpGroups = {
  groups: IpGroup[];
  truncated: boolean;
  meta: Meta;
};
