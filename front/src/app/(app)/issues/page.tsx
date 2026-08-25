import { IssuesView } from "@components/issues/IssuesView";

/**
 * `/issues` — grouped errors (IKN-14).
 *
 * Under `(app)`, so it inherits the chassis, the session boundary and `force-dynamic` for free.
 * There is nothing to fetch on the server: the rail's selection is in the URL and every read here
 * is a polled client hook, so this page is the mount point and nothing more.
 */
export default function IssuesPage() {
  return <IssuesView />;
}
