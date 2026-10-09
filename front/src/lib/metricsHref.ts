import { ROUTES } from "@lib/routes";

import type { MetricsHref } from "@lib/metricsTypes";

/**
 * A link **into** the metrics view (IKN-23) — the service tiles' destination.
 *
 * Built fresh, like `logsHref`: the service and the range travel, and nothing else does. A log
 * filter carried into a view that does not read it would sit in the URL waiting to surprise the
 * next view that does.
 */
export const metricsHref = ({ service, range }: MetricsHref): string =>
  `${ROUTES.metrics}?${new URLSearchParams({ service, range })}`;
