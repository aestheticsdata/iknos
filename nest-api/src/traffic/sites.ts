import type { Prisma } from "@generated/prisma/client";

/**
 * What makes a service a site: an access log of its own, or a domain the shared log names
 * (IKN-84). One definition, read by the collector, the Traffic routes and the services list, so
 * the three cannot disagree about which rows have traffic.
 */
export const SITE_WHERE = {
  OR: [{ logGlob: { not: null } }, { hosts: { not: null } }],
} satisfies Prisma.ServiceWhereInput;

/** The same test on a row already read. */
export const isSite = (row: Pick<Prisma.ServiceGetPayload<object>, "logGlob" | "hosts">) =>
  row.logGlob !== null || row.hosts !== null;
