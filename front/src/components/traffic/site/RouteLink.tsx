import { logsHref } from "@lib/logsHref";
import { TRAFFIC_TEXT } from "@text/traffic";
import Link from "next/link";

import type { SiteScope } from "../interfaces/trafficViewTypes";

/** A path that opens its own raw lines in Logs — every number on the page can be checked there. */
export const RouteLink = ({ scope, route }: RouteLinkProps) => (
  <Link
    href={logsHref({ range: scope.range, values: { service: scope.service, route } })}
    title={TRAFFIC_TEXT.openInLogs(route)}
    className="block max-w-full truncate font-mono underline-offset-2 transition-colors duration-150 ease-out hover:underline"
  >
    {route}
  </Link>
);

type RouteLinkProps = {
  scope: SiteScope;
  route: string;
};
