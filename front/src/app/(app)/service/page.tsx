import { ROUTES } from "@lib/routes";
import { redirect } from "next/navigation";

/**
 * Where `/service` went — IKN-13.
 *
 * It was a second route showing the log panel with a header above it, which is what `/logs` now
 * does whenever the rail has a service selected. Rather than delete the path and 404 every link
 * that was shipped with it — the tiles' own hrefs, a bookmark, a URL pasted into a ticket — it
 * forwards, carrying the whole query string: the service, the range, the filters and the pin all
 * mean the same thing at the destination, so the reader lands on exactly the screen they asked for.
 */
export default async function ServiceRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    // A repeated key is a list — `off` is one — and collapsing it to its last value would silently
    // switch filters back on at the destination.
    if (Array.isArray(value)) for (const one of value) query.append(key, one);
    else if (value !== undefined) query.set(key, value);
  }

  const search = query.toString();
  redirect(search ? `${ROUTES.logs}?${search}` : ROUTES.logs);
}
