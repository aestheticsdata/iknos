import { AppChassis } from "@components/chassis/AppChassis";

/**
 * Never prerendered.
 *
 * The rail is built from `/api/services` read with the caller's cookie, and the bars read the
 * selected service and range out of the query string — neither has an answer at build time. Saying
 * so here is also what keeps a signed-in user's service list from being baked into a static file.
 */
export const dynamic = "force-dynamic";

/**
 * Everything behind a session renders inside the chassis. The auth screens sit outside this group
 * on purpose — they have a chassis of their own and no rail to scope.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppChassis>{children}</AppChassis>;
}
