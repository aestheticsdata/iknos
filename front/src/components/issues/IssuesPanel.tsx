"use client";

import { Card } from "@components/ui/Card";
import { Pending } from "@components/ui/Pending";
import { SURFACE_SCROLL, SURFACE_TEXT_DIM, SURFACE_TEXT_MUTED } from "@components/ui/surface";
import { useOpenIssue } from "@lib/issueState";
import { ROUTES } from "@lib/routes";
import { RAIL_LIMIT, useIssueCounts, useIssues } from "@lib/useIssues";
import { cn } from "@lib/utils";
import { ISSUES_TEXT } from "@text/issues";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { IssueRowCompact } from "./IssueRowCompact";

/**
 * The issues panel in the work area's right column (IKN-14 §2).
 *
 * **Four rows at most.** The ticket says a rail that scrolls everything is not a rail, and the
 * footer is what makes the ceiling honest: `N more unresolved · open Issues →` is read from the
 * segment counts rather than from the page, so it is the true remainder and not "there might be
 * more". The count route is already being read for the rail's badge, so it costs nothing here.
 *
 * **Three empty states, never collapsed into one.** `Signals.tsx` names collapsing them as the one
 * thing a monitoring tool must not do, and this is the panel where it would be most tempting: a
 * failed request is not a quiet hour, and neither of them is a collector that has not grouped
 * anything yet. All three are an empty box; only the words tell the reader which one they are
 * looking at.
 */
export const IssuesPanel = ({ service }: { service: string }) => {
  const issues = useIssues(service, "unresolved", { limit: RAIL_LIMIT });
  const counts = useIssueCounts(service);
  const [, openIssue] = useOpenIssue();

  // The scope travels with the link, exactly as the rail's own view links do: arriving at the
  // issues view having lost the service you were looking at is arriving at a different question.
  const search = useSearchParams().toString();
  // `issues.rows`, not the payload's: the claim overlay has already taken out anything just
  // resolved, so a row the reader has acted on leaves the panel at once.
  const rows = issues.rows;
  const remaining = Math.max(0, (counts.data?.unresolved ?? rows.length) - rows.length);

  /*
   * One instant for the whole panel.
   *
   * Four rows each calling `Date.now()` would each get a different one, and two issues seen in the
   * same minute could land in different recency tiers — which is a dot changing colour between two
   * rows for no reason a reader could ever discover.
   */
  const now = Date.now();

  return (
    <Card
      title={ISSUES_TEXT.panelTitle}
      actions={<span className={cn("text-micro", SURFACE_TEXT_DIM.work)}>{ISSUES_TEXT.panelNote}</span>}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      // The body is the scrolling child, flush to the card's edges — see `Card`'s own note.
      bodyClassName={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", SURFACE_SCROLL.work)}
    >
      {rows.length > 0 ? (
        <>
          {rows.map((row) => (
            <IssueRowCompact
              key={row.fingerprint}
              row={row}
              now={now}
              onOpen={() => openIssue(row.fingerprint)}
            />
          ))}
          {remaining > 0 && (
            <Link
              href={search ? `${ROUTES.issues}?${search}` : ROUTES.issues}
              className={cn(
                "bg-work-inset px-2.75 py-1.75 text-micro transition-colors duration-150 ease-out hover:text-work-text",
                SURFACE_TEXT_MUTED.work,
              )}
            >
              {ISSUES_TEXT.more(remaining)}
            </Link>
          )}
        </>
      ) : (
        <Empty
          loading={issues.loading}
          error={issues.error}
          nothingAtAll={
            counts.data !== null && counts.data.unresolved + counts.data.resolved + counts.data.ignored === 0
          }
          onRetry={issues.reload}
        />
      )}
    </Card>
  );
};

/**
 * Why the panel is empty, in the fewest honest words — and it is three different reasons.
 *
 * The mark is what separates the first from the other two: a question while the answer is in
 * flight, a sentence once it is not, and no answer can produce the mark (IKN-57).
 */
const Empty = ({
  loading,
  error,
  nothingAtAll,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  nothingAtAll: boolean;
  onRetry: () => void;
}) => (
  <p className={cn("px-2.75 py-3 text-micro leading-relaxed", SURFACE_TEXT_MUTED.work)}>
    {loading ? (
      <Pending>{ISSUES_TEXT.loading}</Pending>
    ) : error !== null ? (
      <>
        {error}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text"
        >
          {ISSUES_TEXT.retry}
        </button>
      </>
    ) : nothingAtAll ? (
      // Not "nothing is broken": nothing has been *grouped*, which on a fresh install is the
      // collector having had nothing to group rather than a fleet in perfect health.
      ISSUES_TEXT.nothingYet
    ) : (
      ISSUES_TEXT.none
    )}
  </p>
);
