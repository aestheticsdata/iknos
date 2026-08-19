"use client";

import { Badge } from "@components/ui/Badge";
import { Button } from "@components/ui/Button";
import {
  SURFACE_BG,
  SURFACE_BORDER,
  SURFACE_INSET_BG,
  SURFACE_TEXT,
  SURFACE_TEXT_DIM,
  SURFACE_TEXT_MUTED,
  TONE_FILL,
  TONE_TEXT,
} from "@components/ui/surface";
import { severityOf } from "@lib/logTypes";
import { cn } from "@lib/utils";
import { LOGS_TEXT } from "@text/logs";
import { memo, useEffect, useMemo, useRef } from "react";

import type { Tone } from "@components/ui/surface";
import type { LogFeedItem, LogRow } from "@lib/logTypes";

/**
 * The log stream itself — IKN-12 §3, design doc §5.1 item 3.
 *
 * **Purely presentational.** It owns no fetch, no cursor and no selection; the panel above it owns
 * all three and hands them down. That split is what lets the same table render a search result, a
 * live tail and the appended pages of both without knowing which it is looking at — and it is what
 * makes the live tail testable, since a component that fetches its own rows can only be exercised
 * against a server.
 *
 * **The dark window.** Everything here is `chassis-*` on a `work-*` page — design doc U3, "the log
 * stream is the one place you are genuinely in a terminal". The body is `chassis-inset`, the
 * darkest step in the ramp, and the header sits a step lighter on `chassis-surface` so it reads as
 * chrome above the stream rather than as its first line. That inverts `DenseTable`'s relationship
 * between the two, which is one of the reasons this is not a `DenseTable`.
 */

/** The eight columns, and therefore the `colSpan` of every full-width row below the header. */
const COLUMN_COUNT = 8;

/**
 * Which tone a row is drawn in, from the same `severityOf` the histogram splits on.
 *
 * `info` maps to **neutral**, not to the info blue. Nine rows in ten are info; painting all of
 * them makes the two that matter invisible, and the ramp exists for exceptions. The blue is kept
 * for the status column, where 2xx/3xx/4xx/5xx is a genuinely four-valued axis.
 */
const SEVERITY_TONE: Record<ReturnType<typeof severityOf>, Tone> = {
  error: "error",
  warn: "warn",
  info: "neutral",
};

/**
 * HTTP status as a second severity axis.
 *
 * A 500 logged at `info` is still a 500 — services disagree about which failures deserve an error
 * level, and the status code does not. Colouring it independently of the row's level is why both
 * are columns instead of one.
 */
const statusTone = (status: number): Tone => (status >= 500 ? "error" : status >= 400 ? "warn" : "neutral");

/**
 * The time of day, sliced out of the ISO string rather than formatted.
 *
 * `TopBar`'s clock has to defer its first paint to an effect because it reads the browser's own
 * `Date` — the server and the client cannot agree on *now*, and React calls that disagreement a
 * hydration error. This is the other half of that problem and it has a better answer: the instant
 * comes from the payload, so slicing `2026-08-19T14:03:22.481Z` at fixed offsets yields the same
 * string on both sides by construction. `Intl.DateTimeFormat` would not: it reads the runtime's
 * locale and time zone, which are the server's during SSR and the reader's afterwards.
 *
 * The consequence is that the column is **UTC**, matching the API, the cursor and every `from`/`to`
 * in the URL. A column silently in local time next to a URL in UTC is how two people comparing the
 * same link end up describing different incidents.
 */
const timeOfDay = (ts: string): string => {
  const t = ts.indexOf("T");
  if (t < 0) return ts;
  const clock = ts.slice(t + 1, t + 9);
  // Milliseconds are optional in ISO-8601 and the ingest does not promise them, so they are taken
  // only when the separator is actually there — never padded, which would invent precision.
  return ts.charAt(t + 9) === "." ? clock + ts.slice(t + 9, t + 13) : clock;
};

/**
 * The id the expanded pane is announced by.
 *
 * Derived from the feed key rather than from `useId`, which would be one more hook per row across
 * a list this file is explicitly asked to keep cheap. `:` is legal in an HTML id and needs no
 * escaping to be referenced from `aria-controls`.
 */
const detailId = (key: string) => `log-detail:${key}`;

/**
 * Every cell's padding, plus the hover wash.
 *
 * The wash is on the **cells** while the severity tint is on the row, which is the one arrangement
 * that keeps both: a table row's background paints *behind* its cells', so a translucent wash on
 * top lets the red of an error row read through it. Putting the hover on the row itself would
 * replace the tint rather than sit over it, and `brightness` — the house hover elsewhere — is worth
 * nothing on a surface this close to black.
 */
const CELL = "px-2 py-1 group-hover:bg-chassis-raised/40";

/**
 * The stable half of the row's props.
 *
 * Bundled into one object so that `React.memo`'s default comparison over the row's props is both
 * correct *and* cheap — see the note on `LogTableRow`.
 */
type RowActions = {
  select: (key: string) => void;
  expand: (key: string | null) => void;
  openTrace: (traceId: string) => void;
  copy: (row: LogRow) => void;
};

export const LogTable = ({
  items,
  selectedKey,
  expandedKey,
  onSelect,
  onExpand,
  onOpenTrace,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  error,
  onRetry,
  onCopyRow,
}: {
  items: LogFeedItem[];
  selectedKey: string | null;
  expandedKey: string | null;
  onSelect: (key: string) => void;
  onExpand: (key: string | null) => void;
  onOpenTrace: (traceId: string) => void;
  /** The first page is in flight. Distinct from `loadingMore`, which appends to a list already up. */
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  error: string | null;
  onRetry: () => void;
  onCopyRow: (row: LogRow) => void;
}) => {
  /*
   * The four callbacks, held behind a ref so the object handed to every row never changes identity.
   *
   * This is the one piece of machinery the "10 000 rows stay usable" criterion actually needs from
   * the parent boundary: if the panel re-creates `onSelect` on each render — which it will, the
   * moment one of them closes over a piece of state — then every row's props change, every
   * `React.memo` misses, and appending a page re-renders the ten thousand rows already on screen.
   * Stabilising them here means the panel is free to write its handlers however it likes.
   *
   * Written in an effect rather than during render because a ref mutated during render is a
   * mutation the compiler is entitled to move; the window in which `latest` is one render stale is
   * between commit and the passive effect, and nothing in it can be clicked.
   */
  const latest = useRef({ onSelect, onExpand, onOpenTrace, onCopyRow });
  useEffect(() => {
    latest.current = { onSelect, onExpand, onOpenTrace, onCopyRow };
  });

  const actions = useMemo<RowActions>(
    () => ({
      select: (key) => latest.current.onSelect(key),
      expand: (key) => latest.current.onExpand(key),
      openTrace: (traceId) => latest.current.onOpenTrace(traceId),
      copy: (row) => latest.current.onCopyRow(row),
    }),
    [],
  );

  return (
    /*
     * **No scroll container here**, unlike `DenseTable`, which wraps its table in `overflow-x-auto`.
     * `overflow-x: auto` computes `overflow-y` to `auto` as well, so that wrapper would quietly
     * become this list's vertical scroller — and the live tail's PAUSED state (IKN-12 §4) is
     * computed from the scroll position of the panel that owns the tail. A scroller nested here
     * would hold a position nothing reads, the tail would believe it is always at the top, and new
     * lines would keep yanking the reader away from the row they were looking at. The panel scrolls;
     * the header below sticks to whatever that scroller turns out to be.
     *
     * `isolate` so the sticky header's `z-10` is spent inside this panel rather than coming out to
     * compete with the chassis around it — the toast stack sits at `z-50` and the header has no
     * business anywhere near it. Modals are native `<dialog>`s in the top layer and are unaffected.
     */
    <div className={cn("isolate", SURFACE_INSET_BG.chassis, SURFACE_TEXT.chassis)}>
      <table className="w-full border-collapse text-row tabular-nums">
        <thead>
          <tr>
            {/* `time` is left-aligned despite being numeric: it is the column the eye returns to
                between rows, and an anchor belongs at the edge it is read from. `tabular-nums` on
                the table already gives it the alignment right-justifying would have bought. */}
            <HeaderCell>{LOGS_TEXT.columns.time}</HeaderCell>
            <HeaderCell>{LOGS_TEXT.columns.level}</HeaderCell>
            <HeaderCell>{LOGS_TEXT.columns.service}</HeaderCell>
            <HeaderCell>{LOGS_TEXT.columns.route}</HeaderCell>
            <HeaderCell numeric>{LOGS_TEXT.columns.status}</HeaderCell>
            {/* The only cell with a width: `w-full` in an auto-layout table hands the message every
                pixel the other seven do not claim, which is the whole shape of the row. */}
            <HeaderCell className="w-full">{LOGS_TEXT.columns.message}</HeaderCell>
            <HeaderCell>{LOGS_TEXT.columns.trace}</HeaderCell>
            <HeaderCell numeric>{LOGS_TEXT.columns.duration}</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {items.map((item) =>
            item.kind === "gap" ? (
              <GapRow
                key={item.key}
                dropped={item.dropped}
              />
            ) : (
              <LogTableRow
                key={item.key}
                rowKey={item.key}
                row={item.row}
                selected={item.key === selectedKey}
                expanded={item.key === expandedKey}
                actions={actions}
              />
            ),
          )}
          {/*
           * `!loading` matters: an empty list during the first fetch is not an empty result, and
           * saying "nothing matches these filters" before the answer has arrived sends someone
           * editing filters that were never applied.
           */}
          {items.length === 0 && !error && !loading && (
            <tr>
              <td
                colSpan={COLUMN_COUNT}
                className={cn("px-2 py-6 text-center", SURFACE_TEXT_DIM.chassis)}
              >
                {LOGS_TEXT.empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Footer
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        error={error}
        onRetry={onRetry}
        exhausted={items.length > 0}
      />
    </div>
  );
};

const HeaderCell = ({
  numeric,
  className,
  children,
}: {
  numeric?: boolean;
  className?: string;
  children: React.ReactNode;
}) => (
  <th
    scope="col"
    className={cn(
      // Sticky, for `DenseTable`'s reason and more so: scrolling ten thousand rows and losing which
      // column is which is the failure this header exists to prevent. It needs an opaque background
      // of its own — the stream slides underneath it, not behind a transparent strip.
      "sticky top-0 z-10 border-b px-2 py-1 text-left text-kicker tracking-kicker uppercase",
      SURFACE_BG.chassis,
      SURFACE_BORDER.chassis,
      SURFACE_TEXT_DIM.chassis,
      numeric && "text-right",
      className,
    )}
  >
    {children}
  </th>
);

/**
 * One line of the stream, and its detail pane when it is the expanded one.
 *
 * **Memoised on the default comparison, on purpose.** Every prop is either a primitive, the
 * `LogRow` object as it came out of `JSON.parse` (whose identity survives the parent rebuilding
 * `items`, which is exactly why `row` is passed rather than the `LogFeedItem` wrapper), or the one
 * `actions` object that never changes. A hand-written comparator would be the same three
 * comparisons with a trap attached: it would go on returning `true` for a prop added next year and
 * the bug would present as a row that renders stale.
 *
 * What that buys, honestly: appending a page, moving the selection, or opening a row re-renders the
 * rows that changed and skips the rest, so interaction cost stops scaling with the list. What it
 * does **not** buy is the first paint — ten thousand `<tr>`s are ten thousand `<tr>`s, and the
 * browser still lays out and keeps every one of them. If the criterion is not met on a real
 * ten-thousand-row page, the remaining lever is virtualisation (render the visible window, spacer
 * rows above and below), which needs a scroll container this file deliberately does not own. That
 * is a measurement nobody has taken yet, and this comment is not claiming it has.
 */
const LogTableRow = memo(
  ({
    row,
    rowKey,
    selected,
    expanded,
    actions,
  }: {
    row: LogRow;
    rowKey: string;
    selected: boolean;
    expanded: boolean;
    actions: RowActions;
  }) => {
    const severity = severityOf(row.level);
    const tone = SEVERITY_TONE[severity];
    const isError = severity === "error";
    // Lifted out of `row` so the narrowing survives into the click handler — TypeScript widens a
    // property back to `string | null` inside a closure, since nothing stops the object changing
    // between the check and the call.
    const traceId = row.traceId;

    const toggle = () => {
      actions.select(rowKey);
      actions.expand(expanded ? null : rowKey);
    };

    return (
      <>
        {/* The click handler lives on the row and there is deliberately no key handler beside it:
            the keyboard path is the real <button> in the time cell, whose activation already
            arrives here as a click. Handling keys on the <tr> as well would fire the toggle twice
            for every Enter — open, then immediately closed — and the <tr> is not focusable, so
            nothing would ever reach such a handler on its own. */}
        <tr
          onClick={toggle}
          aria-current={selected ? "true" : undefined}
          className={cn(
            "group border-b",
            SURFACE_BORDER.chassis,
            // The error tint is a *row* fact, so it is painted on the row rather than on the level
            // cell: what makes an error findable while scrolling past it at speed is the band, not
            // the four letters in column two.
            isError && "bg-chassis-error-bg",
            // `!isError` is load-bearing: both are `bg-*`, so without it the merge keeps the last
            // and a selected error row silently loses the red band that made it findable. The left
            // rule below already answers "where am I", so selection gives the tint up, not the
            // other way round.
            selected && !isError && "bg-chassis-raised",
          )}
        >
          <td className={cn(CELL, "relative whitespace-nowrap", SURFACE_TEXT_MUTED.chassis)}>
            {/*
             * The left rule. Selection wins over severity when a row is both, because the rule
             * answers "where am I" and the row is still visibly red from its tint and its level.
             * `bg-brand` rather than `TONE_FILL.chassis.ok`: colors.css keeps *brand* and *ok* on
             * separate tokens precisely so a re-theme cannot recolour health, and a selected row is
             * not a healthy one.
             */}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-0 left-0 w-0.5",
                selected ? "bg-brand" : isError ? TONE_FILL.chassis.error : "bg-transparent",
              )}
            />
            {/*
             * The row's keyboard handle, and the whole of its accessible expand semantics. It
             * carries no handler of its own — the click bubbles to the <tr> above, which is the one
             * place the toggle is written.
             *
             * `title` is where the full instant lives, since the column shows a time of day with no
             * date on it. The accessible name is that same full instant plus what pressing this
             * does, which the column alone cannot say; the visible text is a substring of the ISO
             * string, so WCAG's label-in-name still holds and "activate 14:03:22" still works.
             */}
            <button
              type="button"
              title={row.ts}
              aria-expanded={expanded}
              aria-controls={expanded ? detailId(rowKey) : undefined}
              aria-label={`${row.ts} · ${expanded ? LOGS_TEXT.collapseRow : LOGS_TEXT.expandRow}`}
              className="text-left"
            >
              {timeOfDay(row.ts)}
            </button>
          </td>

          <td className={cn(CELL, "whitespace-nowrap")}>
            <Badge
              tone={tone}
              surface="chassis"
            >
              {row.levelName}
            </Badge>
          </td>

          <td className={cn(CELL, "whitespace-nowrap", SURFACE_TEXT.chassis)}>{row.service}</td>

          <td className={cn(CELL, "whitespace-nowrap", SURFACE_TEXT_MUTED.chassis)}>{row.route ?? <NoValue />}</td>

          <td className={cn(CELL, "text-right whitespace-nowrap", SURFACE_TEXT_MUTED.chassis)}>
            {row.statusCode === null ? (
              <NoValue />
            ) : (
              <span className={TONE_TEXT.chassis[statusTone(row.statusCode)]}>{row.statusCode}</span>
            )}
          </td>

          <td className={cn(CELL, SURFACE_TEXT.chassis)}>
            {/*
             * `max-w-[72ch]` is structural, not decorative: without a definite width `truncate` can
             * never engage in an auto-layout table, and one 4KB line would then set the width of
             * every row under it. The full text is in the title and, unclipped, in the detail pane.
             */}
            <span
              title={row.message}
              className="block max-w-[72ch] truncate"
            >
              {row.message}
            </span>
          </td>

          <td className={cn(CELL, "whitespace-nowrap")}>
            {traceId === null ? (
              <NoValue />
            ) : (
              <button
                type="button"
                // The trace button sits inside a row whose every click toggles expansion, so it has
                // to stop there — otherwise opening a trace also opens the pane behind the modal.
                onClick={(event) => {
                  event.stopPropagation();
                  actions.openTrace(traceId);
                }}
                title={traceId}
                aria-label={`${LOGS_TEXT.openTrace} ${traceId}`}
                className={cn(
                  "underline decoration-dotted underline-offset-2 hover:brightness-125",
                  TONE_TEXT.chassis.info,
                )}
              >
                {/* Eight characters is enough to recognise a trace across a screenful and to spot
                    two rows sharing one; the full id is on the title and on the accessible name. */}
                {traceId.slice(0, 8)}
              </button>
            )}
          </td>

          <td className={cn(CELL, "text-right whitespace-nowrap", SURFACE_TEXT_MUTED.chassis)}>
            {row.durationMs === null ? (
              <NoValue />
            ) : (
              <>
                {row.durationMs}
                <span className={cn("ml-0.5", SURFACE_TEXT_DIM.chassis)}>ms</span>
              </>
            )}
          </td>
        </tr>

        {/* Mounted for the one expanded row and no other — `expandedKey` is a single value, so the
            detail pane exists at most once in the document however long the list grows. */}
        {expanded && (
          <RowDetail
            row={row}
            rowKey={rowKey}
            isError={isError}
            actions={actions}
          />
        )}
      </>
    );
  },
);

LogTableRow.displayName = "LogTableRow";

/**
 * The expanded row — the raw event on the left, the line's context on the right.
 *
 * **What is not here is the point.** `LogRow` carries no `attrs` and no `stack`: IKN-19 leaves both
 * out of the list payload deliberately, because two hundred rows of arbitrary JSON is a payload
 * nobody reads and everybody pays for. So this pane renders what the row genuinely has and nothing
 * else — no invented keys, no empty `attrs: {}`. The deeper detail wants a per-row fetch
 * (`GET /api/logs/:id`) that IKN-19 does not expose yet; when it does, it lands here and the two
 * panes stop being redundant.
 *
 * For an error the right pane is headed `stack` and leads with the message unclipped and
 * pre-wrapped, because a pino-serialised error folds `err.stack` into exactly that field. That is
 * the row showing what it has, not this file claiming a stack exists.
 */
const RowDetail = ({
  row,
  rowKey,
  isError,
  actions,
}: {
  row: LogRow;
  rowKey: string;
  isError: boolean;
  actions: RowActions;
}) => {
  // Same narrowing problem as in the row above, same answer.
  const traceId = row.traceId;

  return (
    <tr className={cn("border-b bg-chassis-deep", SURFACE_BORDER.chassis)}>
      <td
        colSpan={COLUMN_COUNT}
        id={detailId(rowKey)}
        className="animate-in px-2 py-2.5"
      >
        {/* One column below `rail`, where the rail has already folded and two panes of JSON side by
            side would each be too narrow to hold a line of it. */}
        <div className="grid grid-cols-1 gap-3 rail:grid-cols-2">
          <section>
            <PaneHeading>{LOGS_TEXT.rawEvent}</PaneHeading>
            {/*
             * The row serialised, which *is* the raw event as far as the client has one — the same
             * object `copy NDJSON` puts on the clipboard, pretty-printed. Reading it back off the
             * row rather than keeping a second copy of the response body keeps the two honest.
             */}
            <pre
              className={cn(
                "overflow-x-auto rounded-chip border p-2 text-row leading-hint",
                SURFACE_BORDER.chassis,
                SURFACE_INSET_BG.chassis,
                SURFACE_TEXT_MUTED.chassis,
              )}
            >
              {JSON.stringify(row, null, 2)}
            </pre>
          </section>

          <section>
            <PaneHeading>{isError ? LOGS_TEXT.stack : LOGS_TEXT.context}</PaneHeading>
            <div className={cn("rounded-chip border p-2", SURFACE_BORDER.chassis, SURFACE_INSET_BG.chassis)}>
              {isError && (
                <pre className={cn("mb-2 text-row leading-hint whitespace-pre-wrap", TONE_TEXT.chassis.error)}>
                  {row.message}
                </pre>
              )}
              {/*
               * Every pair the row genuinely carries, and no line for one it does not — a `route` of
               * `—` on a worker's log line describes nothing that happened. The labels are the column
               * names rather than a second vocabulary, so the pane reads as the row unfolded.
               */}
              <dl className="flex flex-col gap-1 text-row">
                <DetailField label={LOGS_TEXT.columns.time}>{row.ts}</DetailField>
                <DetailField label={LOGS_TEXT.columns.service}>{row.service}</DetailField>
                <DetailField label={LOGS_TEXT.columns.level}>
                  {row.levelName} ({row.level})
                </DetailField>
                {row.route !== null && (
                  <DetailField label={LOGS_TEXT.columns.route}>
                    {row.httpMethod === null ? row.route : `${row.httpMethod} ${row.route}`}
                  </DetailField>
                )}
                {row.statusCode !== null && (
                  <DetailField label={LOGS_TEXT.columns.status}>{row.statusCode}</DetailField>
                )}
                {row.durationMs !== null && (
                  <DetailField label={LOGS_TEXT.columns.duration}>{row.durationMs} ms</DetailField>
                )}
                {traceId !== null && <DetailField label={LOGS_TEXT.columns.trace}>{traceId}</DetailField>}
              </dl>
            </div>
          </section>
        </div>

        {/*
         * Two actions, and `issue` is **absent rather than disabled**. Raising an issue from a line
         * is IKN-14's, and the design doc's rule about a control that is visible and dead applies to
         * it: a greyed `issue` here reads as a permission problem or as a broken build, and would
         * have to be un-greyed by the ticket that can actually answer it anyway.
         */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {traceId !== null && (
            <Button
              variant="quiet"
              onClick={() => actions.openTrace(traceId)}
            >
              {LOGS_TEXT.openTrace}
            </Button>
          )}
          {/* The clipboard write and the `copied` toast belong to the panel: this table is rendered
              in contexts that have no toast provider, and a component that writes to the clipboard
              is a component that cannot be rendered in a test without a permission prompt. */}
          <Button
            variant="quiet"
            onClick={() => actions.copy(row)}
          >
            {LOGS_TEXT.copyRow}
          </Button>
        </div>
      </td>
    </tr>
  );
};

const PaneHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className={cn("pb-1 text-kicker tracking-kicker uppercase", SURFACE_TEXT_DIM.chassis)}>{children}</h3>
);

/**
 * One key and its value.
 *
 * Wrapped in a `<div>` rather than left as a bare `dt`/`dd` pair, which HTML5 allows precisely so a
 * list like this can be laid out in rows without a grid template: `w-14` reserves the label column
 * at a step off the spacing scale, and the value takes what is left and wraps inside it.
 */
const DetailField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-2">
    <dt className={cn("w-14 flex-none", SURFACE_TEXT_DIM.chassis)}>{label}</dt>
    <dd className={cn("min-w-0 flex-1 break-all", SURFACE_TEXT.chassis)}>{children}</dd>
  </div>
);

/**
 * A missing value, drawn and not announced.
 *
 * `aria-hidden` because the dash is there so an empty cell does not read as a rendering fault; to a
 * screen reader the cell is genuinely empty, which is the true statement, and a column of "dash,
 * dash, dash" read aloud is noise.
 */
const NoValue = () => (
  <span
    aria-hidden="true"
    className={SURFACE_TEXT_DIM.chassis}
  >
    –
  </span>
);

/**
 * The hole the tail admits to — `event: lagged`, rendered where the lines would have been.
 *
 * Drawn as a break rather than as a row: no columns, rules running out to both edges, and the
 * warn tone. The requirement it is answering is that it must be impossible to mistake for a log
 * line, because the whole reason the API sends `lagged` at all is that a tail which silently skips
 * lines still looks perfectly continuous.
 */
const GapRow = ({ dropped }: { dropped: number }) => (
  <tr>
    <td
      colSpan={COLUMN_COUNT}
      className="px-2 py-2"
    >
      {/* A sentence, so `text-micro` rather than the letterspaced uppercase kicker the header uses:
          `3 LINES DROPPED — THE TAIL COULD NOT KEEP UP` set at 0.16em is a banner, and this is a
          thing to read. The dashed rules are what carry "not a row". */}
      <div className={cn("flex items-center gap-2 text-micro", TONE_TEXT.chassis.warn)}>
        <span
          aria-hidden="true"
          className={cn("h-0 flex-1 border-t border-dashed", SURFACE_BORDER.chassis)}
        />
        {LOGS_TEXT.gap(dropped)}
        <span
          aria-hidden="true"
          className={cn("h-0 flex-1 border-t border-dashed", SURFACE_BORDER.chassis)}
        />
      </div>
    </td>
  </tr>
);

/**
 * The end of the list — the cursor's control, or the failure that stopped it.
 *
 * **No page numbers, ever.** The API pages on an opaque `(ts, id)` cursor and appends; page 4 of a
 * live stream is not a thing that exists, and offering it would mean either lying or re-querying
 * from the top every time the tail delivers a line.
 *
 * The failure copy is the caller's string rather than `LOGS_TEXT.searchFailed`, because the same
 * strip reports a first search that failed and a fourth page that failed, and only the panel knows
 * which one happened.
 */
const Footer = ({
  hasMore,
  loadingMore,
  onLoadMore,
  error,
  onRetry,
  exhausted,
}: {
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  error: string | null;
  onRetry: () => void;
  exhausted: boolean;
}) => {
  if (error) {
    return (
      <FooterStrip>
        <span
          role="alert"
          className={TONE_TEXT.chassis.error}
        >
          {error}
        </span>
        <Button
          variant="quiet"
          onClick={onRetry}
        >
          {LOGS_TEXT.retry}
        </Button>
      </FooterStrip>
    );
  }

  if (hasMore) {
    return (
      <FooterStrip>
        {/* One control in one place rather than a button swapped for a spinner: the label changes,
            the button does not move, and the pointer stays over the thing it is about to press
            again. `aria-busy` is what says "working" to anyone not watching the label. */}
        <Button
          variant="quiet"
          onClick={onLoadMore}
          disabled={loadingMore}
          aria-busy={loadingMore}
        >
          {loadingMore ? LOGS_TEXT.loading : LOGS_TEXT.loadMore}
        </Button>
      </FooterStrip>
    );
  }

  if (loadingMore) {
    return (
      <FooterStrip>
        <span className={SURFACE_TEXT_DIM.chassis}>{LOGS_TEXT.loading}</span>
      </FooterStrip>
    );
  }

  // Silent on an empty result: the body already says why there is nothing, and "that is every line
  // in the range" under "no lines match" is the same sentence twice, the second time smugly.
  if (!exhausted) return null;

  return (
    <FooterStrip>
      <span className={SURFACE_TEXT_DIM.chassis}>{LOGS_TEXT.endOfResults}</span>
    </FooterStrip>
  );
};

const FooterStrip = ({ children }: { children: React.ReactNode }) => (
  <div className={cn("flex items-center justify-center gap-3 border-t px-2 py-3 text-row", SURFACE_BORDER.chassis)}>
    {children}
  </div>
);
