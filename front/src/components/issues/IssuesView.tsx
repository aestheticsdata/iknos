"use client";

import { Pending } from "@components/ui/Pending";
import { SURFACE_SCROLL } from "@components/ui/surface";
import { useSelectedService } from "@lib/chassisState";
import { SEGMENTS, useIssueSegment, useIssueSort, useOpenIssue } from "@lib/issueState";
import { ISSUE_SORTS } from "@lib/issueTypes";
import { useIssueCounts, useIssues } from "@lib/useIssues";
import { cn } from "@lib/utils";
import { ISSUES_TEXT } from "@text/issues";
import { useState } from "react";
import { IssuesTable } from "./IssuesTable";

/**
 * The issues view (IKN-14 §1) — the full table, its three segments and its three sorts.
 *
 * The detail modal is **not** mounted here: it hangs off the chassis so that `?issue=` opens it
 * from any view — see `IssueModal`'s own note. This page only writes the parameter.
 *
 * **Scoped by the rail, like every other view.** The rail's selection re-scopes the whole
 * application, and a table of the fleet's issues sitting under a rail that says `pfa-api` would be
 * the one thing on screen answering a different question.
 *
 * Segment and sort live in the URL (`issueState.ts`), so a triage view is a link. The open issue
 * does too, which is what lets `⌘I` on a log row and a click in the rail panel arrive at the same
 * modal without either of them knowing the other exists.
 */

/** One page, and how much more a click asks for. The API's own ceiling is `MAX_LIMIT`, 200. */
const PAGE = 50;
const CEILING = 200;

export const IssuesView = () => {
  const [service] = useSelectedService();
  const [segment, setSegment] = useIssueSegment();
  const [sort, setSort] = useIssueSort();
  const [, setOpen] = useOpenIssue();
  const [limit, setLimit] = useState(PAGE);

  const issues = useIssues(service, segment, { sort, limit });
  const counts = useIssueCounts(service);

  const page = issues.data;
  // `issues.rows` rather than `page.rows`: the claim overlay has already taken out anything the
  // reader has just resolved or ignored, which is what makes the action feel like it landed.
  const rows = issues.rows;
  const hasMore = page !== null && page.nextCursor !== null;
  // The server said there is more and the limit is already at its ceiling — the one case the
  // button cannot answer, and the footer says so rather than disappearing.
  const capped = hasMore && limit >= CEILING;

  return (
    <div className="flex h-full min-h-0 flex-col bg-work-ground px-3 py-2.75">
      <header className="mb-2.75 flex flex-none flex-wrap items-center gap-3 rounded-card border border-work-border bg-work-surface px-3.25 py-2">
        <h1 className="font-sans text-ui font-medium text-work-text">{ISSUES_TEXT.title}</h1>
        <span className="text-kicker tracking-kicker text-work-text-dim uppercase">{ISSUES_TEXT.tag}</span>

        {/* The counts beside the labels come from the counts route, never from the page: a segment
            count read off the current page would be the length of the page. */}
        <fieldset
          aria-label={ISSUES_TEXT.segmentLabel}
          className="ml-auto flex items-center gap-1"
        >
          {SEGMENTS.map((one) => (
            <Segment
              key={one}
              active={segment === one}
              onPick={() => {
                setSegment(one);
                // A new segment is a new list; carrying the old one's page size into it would open
                // it already scrolled past its own top.
                setLimit(PAGE);
              }}
            >
              {ISSUES_TEXT.segments[one]}
              {counts.data !== null && <span className="ml-1 tabular-nums text-work-text-dim">{counts.data[one]}</span>}
            </Segment>
          ))}
        </fieldset>

        <fieldset
          aria-label={ISSUES_TEXT.sortLabel}
          className="flex items-center gap-1"
        >
          {ISSUE_SORTS.map((one) => (
            <Segment
              key={one}
              active={sort === one}
              onPick={() => setSort(one)}
            >
              {ISSUES_TEXT.sorts[one]}
            </Segment>
          ))}
        </fieldset>
      </header>

      <section
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto rounded-card border border-work-border bg-work-surface",
          SURFACE_SCROLL.work,
        )}
      >
        {issues.error !== null && rows.length === 0 ? (
          <p className="px-3 py-4 text-row text-work-text-muted">
            {issues.error}{" "}
            <button
              type="button"
              onClick={issues.reload}
              className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text"
            >
              {ISSUES_TEXT.retry}
            </button>
          </p>
        ) : issues.loading ? (
          <p className="px-3 py-4 text-row text-work-text-muted">
            <Pending>{ISSUES_TEXT.loading}</Pending>
          </p>
        ) : (
          <>
            <IssuesTable
              rows={rows}
              spark={page?.spark ?? null}
              onOpen={setOpen}
            />
            {capped ? (
              <p className="px-3 py-2 text-micro text-work-text-dim">{ISSUES_TEXT.capped(rows.length)}</p>
            ) : (
              hasMore && (
                <button
                  type="button"
                  onClick={() => setLimit((current) => Math.min(current + PAGE, CEILING))}
                  className="bg-work-inset px-3 py-2 text-left text-micro text-work-text-muted transition-colors duration-150 ease-out hover:text-work-text"
                >
                  {ISSUES_TEXT.loadMore}
                </button>
              )
            )}
          </>
        )}
      </section>
    </div>
  );
};

/** A segmented control's cell — the shape the range buttons already use in the top bar. */
const Segment = ({ active, onPick, children }: { active: boolean; onPick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onPick}
    aria-pressed={active}
    className={cn(
      "rounded-chip border px-1.5 py-0.5 text-row transition-colors duration-150 ease-out",
      active
        ? "border-work-border-strong bg-work-inset text-work-text"
        : "border-transparent text-work-text-muted hover:text-work-text",
    )}
  >
    {children}
  </button>
);
