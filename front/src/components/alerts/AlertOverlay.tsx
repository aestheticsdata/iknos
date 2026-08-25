"use client";

import { useOpenAlert } from "@lib/alertState";
import { useAlerts } from "@lib/useAlerts";
import { AlertModal } from "./AlertModal";

/**
 * The alert modal, mounted once for the whole chassis.
 *
 * A client boundary and nothing else, exactly like `IssueOverlay`: `AppChassis` is a server
 * component and cannot read the query string, and `?alert=` is set from the rail panel and from the
 * alerts table — two views, one modal.
 *
 * The cadence comes off a list read the modal makes anyway. It asks for a single row, because it
 * wants the `evalIntervalMs` beside the rows and not the rows: there is no route that serves the
 * engine's cadence alone, and inventing one to avoid a one-row query would be a route existing to
 * carry a constant.
 */
export const AlertOverlay = () => {
  const [id, setId] = useOpenAlert();
  const { evalIntervalMs } = useAlerts(null, "open", { limit: 1, active: id !== null });

  return (
    <AlertModal
      id={id}
      evalIntervalMs={evalIntervalMs}
      onClose={() => setId(null)}
    />
  );
};
