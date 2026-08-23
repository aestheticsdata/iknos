import { ServiceView } from "@components/service/ServiceView";
import { readServices } from "@lib/services";

/**
 * The service view — IKN-13, the view M2 exists to fill.
 *
 * A mount point and nothing else, exactly as `logs/page.tsx` is. The registry is read here, on the
 * server, with the caller's cookie, and handed down: the embedded log panel's service filter needs
 * the same list the rail shows, and fetching it a second time from the browser would let the two
 * disagree about what exists.
 *
 * Which service is being looked at is *not* read here. It lives in the URL, where the rail writes
 * it and every view reads it — so this page renders the same for every service and the selection
 * costs no round trip.
 */
export default async function ServicePage() {
  const services = await readServices();

  return <ServiceView services={services} />;
}
