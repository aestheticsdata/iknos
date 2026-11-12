import { RunsView } from "@components/traces/runs/RunsView";

/**
 * `/traces` — the AI pipeline runs the Officina apps report over OTLP (IKN-87), with their checks,
 * human reviews and versions (IKN-91).
 *
 * Under `(app)`, so it inherits the chassis, the session boundary and `force-dynamic`. Every read
 * is a client hook and the filters are in the URL, so this page is the mount point and nothing more.
 */
export default function TracesPage() {
  return <RunsView />;
}
