import { MetricsView } from "@components/metrics/MetricsView";

/**
 * `/metrics` — which route costs the selected service its p95 (IKN-23).
 *
 * Under `(app)`, so it inherits the chassis, the session boundary and `force-dynamic`. Every read is
 * a client hook and the selection is in the URL, so this page is the mount point and nothing more.
 */
export default function MetricsPage() {
  return <MetricsView />;
}
