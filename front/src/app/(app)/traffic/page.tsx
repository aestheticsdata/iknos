import { TrafficView } from "@components/traffic/TrafficView";
import { readServices } from "@lib/services";

/**
 * `/traffic` — who visits the sites, read from the nginx access logs (IKN-83).
 *
 * The registry is read here, on the server, as `logs/page.tsx` does: the view needs to know which
 * services are sites before it asks for any traffic, and the rail beside it was drawn from the same
 * list. Everything else is a client hook, and the selection is in the URL.
 */
export default async function TrafficPage() {
  const services = await readServices();

  return <TrafficView services={services} />;
}
