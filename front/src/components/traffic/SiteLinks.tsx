"use client";

import { useSelectedService } from "@lib/chassisState";
import { TRAFFIC_TEXT } from "@text/traffic";

/** The sites as buttons that select them in the rail — the way out of a service with no traffic. */
export const SiteLinks = ({ sites }: SiteLinksProps) => {
  const [, select] = useSelectedService();

  if (sites.length === 0) return <p>{TRAFFIC_TEXT.noSites}</p>;

  return (
    <nav
      aria-label={TRAFFIC_TEXT.sitesHeading}
      className="flex flex-wrap justify-center gap-2"
    >
      {sites.map((site) => (
        <button
          key={site}
          type="button"
          onClick={() => select(site)}
          className="rounded-card border border-work-border bg-work-surface px-2 py-1 text-row text-work-text transition-colors duration-150 ease-out hover:border-work-text-dim"
        >
          {site}
        </button>
      ))}
    </nav>
  );
};

type SiteLinksProps = {
  sites: string[];
};
