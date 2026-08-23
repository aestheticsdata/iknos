import { WorkArea } from "@components/service/WorkArea";
import { readServices } from "@lib/services";

/**
 * The one view behind the session — IKN-12, joined by IKN-13's header and tiles.
 *
 * The registry is read here, on the server, with the caller's cookie, and handed down: the query
 * bar's service filter needs the same list the rail shows, and fetching it a second time from the
 * browser would mean the two could disagree about what exists.
 *
 * Everything else is `WorkArea`'s, which decides from the rail's selection whether this is the
 * full-width log explorer or one service's dashboard with the same panel underneath. This page is
 * deliberately nothing but a mount point, and *which* shape it takes is not read here: the
 * selection lives in the URL, so it costs no round trip and the back button walks it.
 */
export default async function LogsPage() {
  const services = await readServices();

  return <WorkArea services={services} />;
}
