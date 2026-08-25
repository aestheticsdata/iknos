"use client";

import { useOpenIssue } from "@lib/issueState";
import { IssueModal } from "./IssueModal";

/**
 * The issue modal, mounted once for the whole chassis.
 *
 * A client boundary and nothing else: `AppChassis` is a server component and cannot read the query
 * string, and the modal has to be reachable from every view — `?issue=` is set by the rail panel,
 * by the issues table and by `⌘I` on a log row, and the last of those fires from a page with no
 * issues list on it at all.
 */
export const IssueOverlay = () => {
  const [fingerprint, setFingerprint] = useOpenIssue();

  return (
    <IssueModal
      fingerprint={fingerprint}
      onClose={() => setFingerprint(null)}
    />
  );
};
