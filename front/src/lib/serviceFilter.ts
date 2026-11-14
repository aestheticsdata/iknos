import type { Service } from "@lib/services";

/**
 * The rail's search: which services a typed fragment keeps.
 *
 * A case-insensitive substring of the registry name, and of the pm2 name beside it — the two differ
 * for a few services, and whoever types has one of them in their head without knowing which the
 * rail prints. Not fuzzy: forty names are scanned by eye, and a fuzzy match that keeps `bkmk-front`
 * for `bots` is a list that has not narrowed.
 *
 * Several words must all match, in any order, so `front pfa` finds `pfa-front`. An empty query
 * keeps everything and returns the very array it was given.
 */
export const filterServices = (services: Service[], query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return services;

  return services.filter((service) => {
    const haystack = `${service.name} ${service.pm2Name}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
};
