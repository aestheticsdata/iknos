import { TracesView } from "@components/traces/TracesView";

/**
 * `/traces` — the AI pipeline runs the Officina apps report over OTLP, and the span tree of one
 * (IKN-87).
 *
 * Under `(app)`, so it inherits the chassis, the session boundary and `force-dynamic`. Every read
 * is a client hook and the selection is in the URL, so this page is the mount point and nothing
 * more — the metrics page's shape.
 */
export default function TracesPage() {
  return <TracesView />;
}
