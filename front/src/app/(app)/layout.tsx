import { AppChassis } from "@components/chassis/AppChassis";
import { SessionWatcher } from "@components/chassis/SessionWatcher";

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
 *
 * The watcher is mounted here rather than in `AppChassis` for the same reason: this file *is* the
 * "behind a session" boundary, and a component whose only job is to notice that the session ended
 * belongs to the boundary rather than to the layout it draws. It renders nothing (IKN-44).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppChassis>
      <SessionWatcher />
      {children}
    </AppChassis>
  );
}
