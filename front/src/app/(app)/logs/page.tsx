import { LogPanel } from "@components/logs/LogPanel";
import { readServices } from "@lib/services";

/**
 * The logs view — IKN-12, the view that justifies M1.
 *
 * The registry is read here, on the server, with the caller's cookie, and handed down: the query
 * bar's service filter needs the same list the rail shows, and fetching it a second time from the
 * browser would mean the two could disagree about what exists.
 *
 * Everything else is the panel's. This page is deliberately nothing but a mount point, because
 * §6 of the ticket asks for one component at two sizes — this route is the full-screen one, and
 * the embedded copy in the service view (IKN-13) will mount the same component with the same URL
 * state and no code of its own.
 */
export default async function LogsPage() {
  const services = await readServices();

  return <LogPanel services={services} />;
}
