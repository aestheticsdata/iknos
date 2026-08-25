import { AlertsView } from "@components/alerts/AlertsView";

/**
 * `/alerts` — what the collector's rule engine is saying (IKN-15).
 *
 * Under `(app)`, so it inherits the chassis, the session boundary and `force-dynamic` for free.
 * Nothing to fetch on the server: every read here is a polled client hook and the rail's selection
 * is in the URL, so this page is the mount point and nothing more.
 */
export default function AlertsPage() {
  return <AlertsView />;
}
