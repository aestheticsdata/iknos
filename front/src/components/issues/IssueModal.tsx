"use client";

import { Badge } from "@components/ui/Badge";
import { BarSpark } from "@components/ui/BarSpark";
import { Button } from "@components/ui/Button";
import { Modal } from "@components/ui/Modal";
import { Pending } from "@components/ui/Pending";
import { TONE_TEXT } from "@components/ui/surface";
import { useTimeRange } from "@lib/chassisState";
import { formatCount } from "@lib/format";
import { formatAgo, issueTitle, recencyTone } from "@lib/issueFormat";
import { logsHref } from "@lib/logsHref";
import { useIssueActions, useIssueDetail, useOccurrences } from "@lib/useIssues";
import { cn } from "@lib/utils";
import { fullInstant } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { ISSUES_TEXT } from "@text/issues";
import Link from "next/link";

import type { IssueDetail } from "@lib/issueTypes";

/**
 * One issue in full (IKN-14 §3) — five tiles, the 48-hour chart, the latest stack.
 *
 * **The link to the correlated logs is the point of this modal.** Everything else here is a number
 * the row already carried; what it adds is the round trip between an error and the request that
 * produced it, which is the thing a reader actually came for. It carries a bounded window because
 * the log API refuses an unbounded query (IKN-19), and the bound is taken around the occurrence
 * rather than from the reader's current range — the request happened when it happened.
 *
 * **No `closeOnBackdropClick`.** `Modal` turned that default off for these exact callers: this one
 * carries three real actions, and a stray click beside the card must not be one of them.
 *
 * Derived-open and mounted for the whole session, like `RowDetail` and `TraceTimeline` — a
 * `{open && <Modal/>}` never plays its 200 ms exit, and a `<dialog>` torn down in the same frame
 * takes the focus it was going to restore with it.
 *
 * **Mounted on the chassis, not by a list.** `?issue=` is opened from three places — the rail
 * panel, the table, and `⌘I` on a log row, which fires from a view that has no issues list at all
 * — and one modal above all three is the only arrangement where the third of those works. What it
 * costs is that it cannot reach into a list to refresh it; what pays for that is `issueClaims.tsx`,
 * which holds the optimistic state one level higher still.
 */

/**
 * How wide a window the correlated-logs link carries around the occurrence.
 *
 * A trace is one request, so this only has to be wider than a request. Five minutes either side is
 * generous for anything on this box and still narrow enough that the destination prunes to one or
 * two day partitions — which is the whole reason IKN-19 asks for bounds in the first place.
 */
export const TRACE_WINDOW_MS = 5 * 60_000;

export const IssueModal = ({ fingerprint, onClose }: { fingerprint: string | null; onClose: () => void }) => {
  const detail = useIssueDetail(fingerprint);
  const occurrences = useOccurrences(fingerprint);
  const actions = useIssueActions();
  const [range] = useTimeRange();
  const { tz } = useZone();

  const issue = detail.data;
  const status = issue === null ? null : actions.statusOf(issue);

  const act = (action: "resolve" | "ignore" | "reopen") => {
    if (issue === null) return;
    void actions.run(issue.fingerprint, action);
    // Closed on the way out rather than after the round trip: the action was taken on a list, and
    // holding the reader in front of a modal until the server answers undoes what the optimistic
    // update is for. A failure raises a toast over whatever they moved on to, which is where it
    // belongs — the toast says the issue was not changed, and the row is back in the list to prove
    // it.
    onClose();
  };

  return (
    <Modal
      open={fingerprint !== null}
      onClose={onClose}
      // A stack trace needs the width — the same reason `RowDetail` sets it.
      wide
      tag={issue?.service ?? ""}
      title={issue === null ? ISSUES_TEXT.title : issueTitle(issue)}
      hint={issue === null ? undefined : issue.fingerprint}
      actions={
        issue !== null && (
          <>
            {/* Close is an action here too: `Modal` draws no control of its own beyond the `esc`
                hint, and a reader on a keyboard alone still needs something to aim `Enter` at. */}
            <Button
              variant="quiet"
              onClick={onClose}
            >
              {ISSUES_TEXT.close}
            </Button>
            {/* Three acts, and only the two that mean something in the issue's current state. A
                resolve button on an issue that is already resolved is a control that does nothing,
                which the design doc treats the same way as a control that is visibly dead. */}
            {status !== "resolved" && (
              <Button
                variant="quiet"
                onClick={() => act("resolve")}
              >
                {ISSUES_TEXT.resolve}
              </Button>
            )}
            {status !== "ignored" && (
              <Button
                variant="quiet"
                onClick={() => act("ignore")}
              >
                {ISSUES_TEXT.ignore}
              </Button>
            )}
            {status !== "unresolved" && (
              <Button
                variant="quiet"
                onClick={() => act("reopen")}
              >
                {ISSUES_TEXT.reopen}
              </Button>
            )}
          </>
        )
      }
    >
      {issue === null ? (
        <p className="text-row text-chassis-text-muted">
          {detail.error !== null ? detail.error : <Pending>{ISSUES_TEXT.loading}</Pending>}
        </p>
      ) : (
        <Body
          issue={issue}
          status={status ?? issue.status}
          counts={occurrences.data?.counts ?? null}
          chartError={occurrences.error}
          range={range}
          tz={tz}
        />
      )}
    </Modal>
  );
};

const Body = ({
  issue,
  status,
  counts,
  chartError,
  range,
  tz,
}: {
  issue: IssueDetail;
  status: string;
  counts: number[] | null;
  chartError: string | null;
  range: Parameters<typeof logsHref>[0]["range"];
  tz: string;
}) => {
  const now = Date.now();
  const tone = recencyTone(issue.lastSeen, now);
  const at = issue.latest === null ? null : Date.parse(issue.latest.ts);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          tone={tone === "error" ? "error" : "neutral"}
          surface="chassis"
        >
          {status}
        </Badge>
        {/* A regression is the case that wants attention, so it is said in words rather than left
            to a colour — IKN-14 asks for it to be visually distinct, and one man in twelve cannot
            separate the red from the green. */}
        {issue.regression && (
          <Badge
            tone="error"
            surface="chassis"
          >
            {ISSUES_TEXT.regression}
          </Badge>
        )}
      </div>

      {/* Five tiles, the mockup's own set. `min-w-0` on the grid children so a long service name
          or a full fingerprint wraps inside its tile rather than widening the row. */}
      <dl className="grid grid-cols-2 gap-2 rail:grid-cols-5">
        <Tile label={ISSUES_TEXT.tileFingerprint}>{issue.fingerprint}</Tile>
        <Tile label={ISSUES_TEXT.tileOccurrences}>{formatCount(issue.eventCount)}</Tile>
        <Tile
          label={ISSUES_TEXT.tileLastSeen}
          title={fullInstant(issue.lastSeen, tz)}
        >
          {formatAgo(issue.lastSeen, now)}
        </Tile>
        <Tile
          label={ISSUES_TEXT.tileFirstSeen}
          title={fullInstant(issue.firstSeen, tz)}
        >
          {formatAgo(issue.firstSeen, now)}
        </Tile>
        <Tile label={ISSUES_TEXT.tileService}>{issue.service}</Tile>
      </dl>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-kicker tracking-kicker text-chassis-text-dim uppercase">{ISSUES_TEXT.occurrences}</h3>
        <div className="h-16 w-full">
          {counts !== null && counts.length > 0 ? (
            <BarSpark
              values={counts}
              tone={tone === "error" ? "error" : "info"}
              surface="chassis"
              height={64}
              label={ISSUES_TEXT.sparkLabel(issueTitle(issue))}
            />
          ) : (
            <p className="text-row text-chassis-text-dim">
              {chartError !== null ? chartError : <Pending>{ISSUES_TEXT.loading}</Pending>}
            </p>
          )}
        </div>
      </section>

      <section className="flex min-w-0 flex-col gap-1.5">
        <h3 className="text-kicker tracking-kicker text-chassis-text-dim uppercase">{ISSUES_TEXT.stack}</h3>
        {issue.latest?.stack ? (
          /* `overflow-x-auto` on the block rather than a wrap: a stack frame is one line and
             folding it at the card's edge turns twelve frames into twenty-five lines of noise. The
             chassis is `h-dvh`, so this scrolls inside itself and never widens the page. */
          <pre className="ik-scroll-x max-h-64 overflow-auto rounded-chip border border-chassis-border bg-chassis-inset p-2 text-row leading-relaxed text-chassis-text">
            {issue.latest.stack}
          </pre>
        ) : (
          <p className="text-row text-chassis-text-dim">{ISSUES_TEXT.noStack}</p>
        )}
      </section>

      {issue.latest?.traceId && at !== null && !Number.isNaN(at) ? (
        <Link
          href={logsHref({
            range,
            values: { service: issue.service },
            trace: issue.latest.traceId,
            // Bounded around the occurrence, not around the reader's range: the request happened
            // when it happened, and IKN-19 refuses a query with no window at all.
            bounds: {
              from: new Date(at - TRACE_WINDOW_MS).toISOString(),
              to: new Date(at + TRACE_WINDOW_MS).toISOString(),
            },
          })}
          className={cn(
            "self-start text-row underline underline-offset-2 transition-colors duration-150 ease-out hover:text-chassis-text-bright",
            TONE_TEXT.chassis.info,
          )}
        >
          {ISSUES_TEXT.openLogs}
        </Link>
      ) : (
        <p className="text-row text-chassis-text-dim">{ISSUES_TEXT.noTrace}</p>
      )}
    </div>
  );
};

const Tile = ({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) => (
  <div className="min-w-0 rounded-chip border border-chassis-border bg-chassis-inset px-2 py-1.5">
    <dt className="text-kicker tracking-kicker text-chassis-text-dim uppercase">{label}</dt>
    <dd
      title={title}
      className="truncate text-row text-chassis-text-bright"
    >
      {children}
    </dd>
  </div>
);
