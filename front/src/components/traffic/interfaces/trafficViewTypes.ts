import type { RangeKey } from "@lib/timeRange";

/** The site a panel belongs to and the range it was read over — what every route link carries. */
export type SiteScope = {
  service: string;
  range: RangeKey;
};
