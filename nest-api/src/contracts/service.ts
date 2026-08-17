import type { Meta } from "./meta";

/**
 * A monitored application, as the filter list and the service rail see it.
 *
 * Health state and the sparkline series join this payload with IKN-8. Until then they are
 * **absent from the response**, not present and zero: the rail omits what it does not know
 * rather than drawing a flat green line for a service nobody has ever probed.
 */
export type Service = {
  /** What the interface calls it. */
  name: string;
  /** What PM2 calls it — the two are allowed to differ. */
  pm2Name: string;
  enabled: boolean;
};

/** Wrapped rather than a bare array, so that every list response in the API carries a `meta`. */
export type ServiceList = {
  services: Service[];
  meta: Meta;
};
