"use client";

import { LogTable } from "@components/logs/LogTable";
import { QueryBar } from "@components/logs/QueryBar";
import { RowDetail } from "@components/logs/RowDetail";
import { TraceTimeline } from "@components/logs/TraceTimeline";
import { VolumeHistogram } from "@components/logs/VolumeHistogram";
import { Pending } from "@components/ui/Pending";
import { useToast } from "@components/ui/Toast";
import { useCommand } from "@lib/commandState";
import { useLogQueryState } from "@lib/logQuery";
import { useTraceParam } from "@lib/traceState";
import { useHistogram } from "@lib/useHistogram";
import { useLiveTail } from "@lib/useLiveTail";
import { useLogDetail } from "@lib/useLogDetail";
import { useLogSearch } from "@lib/useLogSearch";
import { useTrace } from "@lib/useTrace";
import { cn } from "@lib/utils";
import { usePublishViewStatus } from "@lib/viewStatus";
import { LOGS_TEXT } from "@text/logs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LogFeedItem, LogRow } from "@lib/logTypes";
import type { Service } from "@lib/services";

/**
 * The heading band's two inks, handed to `ik-scroll-head` so it can carry the band across the
 * scrollbar's rail — the 9px the bar takes out of the content box, which the table inside cannot
 * reach into.
 *
 * Not `SURFACE_HEAD_BAND.chassis`: that pair is the inset one every other table uses, and this one
 * is inverted. `chassis-surface` over `chassis-inset` is `LogTable`'s "chrome above the stream,
 * not its first line" — a step lighter, where a `DenseTable` heading is a step darker.
 */
const HEAD_BAND = "[--ik-head-bg:var(--color-chassis-surface)] [--ik-head-line:var(--color-chassis-border)]";

/**
 * How near the list's bottom edge, in pixels, counts as having reached it — a few rows, so the
 * next older page is already in flight while the reader covers the last lines on screen.
 */
const LOAD_OLDER_EDGE = 120;

/**
 * The log panel — the view that justifies M1, IKN-12.
 *
 * Everything below is composed here and nowhere else: the token bar, the histogram, the list and
 * the trace overlay are all presentational, and the three data hooks all read the one
 * `LogQueryState` that `useLogQueryState` keeps in the URL. That is the ticket's central
 * constraint — three consumers, one query — and this file is where it is honoured or broken.
 *
 * **One component, two sizes** (§6). The panel takes no size of its own: it fills its parent, so
 * the full-screen `/logs` route and the future embedded slot in the service view (IKN-13) are the
 * same component in different boxes, sharing the same URL state. Nothing here knows which one it
 * is in.
 */
export const LogPanel = ({ services }: { services: Service[] }) => {
  const { state, range, setValue, toggle, clear, setWindow, jumpTo, unpinWindow, refresh } = useLogQueryState();

  /*
   * Live from the first paint — unless the URL already points at a pinned window.
   *
   * §5.1 specifies the toggle and never says which state to boot into, and off was the unexamined
   * default. Opening a log view onto a still list is the one thing that reads as "the system went
   * quiet" — the same misreading `animate-pulse-live` exists to rule out — and nothing is saved by
   * it: the tail costs one bus listener and one socket, and the rows are in MySQL either way, so a
   * tail is a view onto the write path rather than the delivery of it.
   *
   * The exception is the whole reason the toggle exists. The stream applies `from` and deliberately
   * drops `to` (`withinWindow`, IKN-19), so under a pinned window a running tail stacks rows from
   * now on top of rows from then, in one list with no seam between the two. A link carrying
   * `?from=…&to=…` is someone being sent to an incident, and it has to open on the incident.
   *
   * Read once, at mount, rather than derived from `pinned` on every render: pinning a bucket
   * *while* watching is a deliberate act with the unpin control right beside it, and making that
   * click silently stop the stream would be this component overruling the person using it.
   */
  const [live, setLive] = useState(!state.pinned);
  /*
   * In the URL since IKN-22, not in this component.
   *
   * The ⌘K palette opens a trace from the chassis, and hoisting this panel's state up there to
   * reach it would put the whole of IKN-12's internals one level above their only consumer. The
   * URL is the seam both already share — and it makes a trace a link, which is the most useful
   * thing one person debugging can hand another.
   */
  const [openTraceId, setOpenTraceId] = useTraceParam();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  /*
   * Two independent chains sharing one anchor (IKN-59) — `older` walks toward the start of the
   * window exactly as before, `newer` walks the opposite way from `state.anchor` and simply never
   * fetches while there is no anchor to walk from (`useLogSearch`'s own `enabled`). Two hooks
   * rather than one hook doing both directions: each has its own cursor, its own `hasMore`, its
   * own in-flight request, and conflating them would mean every piece of that state carrying a
   * silent "which way" alongside it.
   */
  const older = useLogSearch(state, "before");
  const newer = useLogSearch(state, "after");
  /* The chart follows the tail — see `useHistogram`. It is handed `live` rather than deciding for
   * itself, so that the one toggle in the bar governs both surfaces and they cannot disagree. */
  const histogram = useHistogram(state, range, live);
  const tail = useLiveTail(state, live);
  const trace = useTrace(openTraceId, state);
  const toast = useToast();

  /*
   * The scroll container is the panel's, not the table's, because the pause rule is about the
   * *reader*: "paused as soon as the user leaves the top of the list". The table cannot know that
   * — it does not own the scrollport — so the decision lives here and the table stays a pure
   * renderer of whatever list it is handed.
   */
  const listRef = useRef<HTMLDivElement | null>(null);
  const [atTop, setAtTop] = useState(true);

  /*
   * The live rows the reader is actually looking at.
   *
   * While scrolled away from the top this is frozen at a snapshot, and everything the tail has
   * received since is counted rather than shown. A feed that reflows under the line you are
   * reading is unusable, and this is the whole reason the ticket asks for pause-on-scroll instead
   * of a pause button alone.
   */
  const [shown, setShown] = useState<LogFeedItem[]>([]);

  useEffect(() => {
    if (atTop) setShown(tail.items);
  }, [atTop, tail.items]);

  /*
   * Pausing drops the buffer, not just the view of it.
   *
   * `items` below already stops reading `shown` the moment `live` goes false, so the session left
   * behind inside the hook was invisible rather than gone — and resuming re-adopted it on the next
   * arrival, putting an hour-old batch at the top of the list as though it had just come in. The
   * rows are in MySQL and `refresh` is how they come back, which makes the tail buffer the one
   * copy there is no reason to keep.
   */
  useEffect(() => {
    if (live) return;
    setShown([]);
    tail.clear();
  }, [live, tail.clear]);

  const held = atTop ? 0 : tail.items.length - shown.length;

  /*
   * The newer-chain's scroll-to-top auto-load (IKN-59) — and the reason it has to *preserve*
   * scroll position, not just prepend.
   *
   * Prepending rows above whatever the reader is looking at pushes that content down by the
   * height of what just arrived; a scroll container does not compensate for that on its own, so
   * without this the reader's eye stays on a screen coordinate while the line under it changes —
   * exactly the "reflows under the line you are reading" failure the live tail's own pause-on-
   * scroll logic exists to rule out, arrived at from the opposite direction. The fix is the
   * standard one for a chat-style backscroll: note the scroll height *before* the fetch that will
   * prepend, then once the new rows have actually painted, add back however much taller the
   * container got. `null` is "no correction pending" — most `newer.rows` changes are not this
   * fetch (the very first anchor fetch, a whole new anchor replacing the last one), and the layout
   * effect below must leave the scrollport alone for all of them.
   */
  const pendingScrollFix = useRef<number | null>(null);

  /*
   * The trigger is a **wheel-up gesture while already at the top** — not a scroll event, and not
   * the `atTop` state, and both of those are graves this code has already been buried in once.
   *
   * A scroll handler never fires for the reader who just landed on a jump: the container opens at
   * `scrollTop === 0`, wheeling up against a top the browser cannot scroll past produces no
   * scroll event at all, so "the reader is asking for newer lines" is invisible to `onScroll` in
   * exactly the case the jump exists for. And an effect keyed on the `atTop` state fires with no
   * gesture whatsoever — the panel opens at the top, so it fetched on arrival, and each page's
   * completion re-ran it before the scroll-position correction's own scroll event could flip
   * `atTop` back off, which walked the whole window to `now` in one unasked-for burst. That burst
   * buried the target the reader had just typed, which is the bug shipped last time.
   *
   * Wheel events have neither problem: they fire whether or not the box can still move, and only
   * a hand on the wheel produces one. One page per arrival at the top is self-limiting — the
   * prepend correction below moves `scrollTop` off zero, so continuing to wheel first scrolls the
   * reader up through the page that just landed, and the next fetch waits until they reach the
   * top again.
   */
  const loadNewer = useCallback(() => {
    if (!state.anchor || live || !newer.hasMore || newer.loadingMore) return;

    const element = listRef.current;
    if (element) pendingScrollFix.current = element.scrollHeight;
    newer.loadMore();
  }, [state.anchor, live, newer.hasMore, newer.loadingMore, newer.loadMore]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (event.deltaY >= 0) return;
      const element = listRef.current;
      // `<=` rather than `=== 0`: a trackpad's rubber-band overscroll can report a small negative
      // value at the boundary, and demanding the exact pixel would miss the strongest possible
      // version of the gesture.
      if (element && element.scrollTop <= 0) loadNewer();
    },
    [loadNewer],
  );

  useLayoutEffect(() => {
    const element = listRef.current;
    const before = pendingScrollFix.current;
    if (!element || before === null) return;

    pendingScrollFix.current = null;
    element.scrollTop += element.scrollHeight - before;
  }, [newer.rows]);

  const onScroll = useCallback(() => {
    const element = listRef.current;
    if (!element) return;

    setAtTop(element.scrollTop <= 0);

    /*
     * The bottom edge asks for the next older page itself — the "load more" button this replaces
     * made the reader stop scrolling to press a control that said what the scrolling already said.
     * The margin fires the fetch a few rows early, so the page is usually on its way down before
     * the reader runs out of list; and appending below the fold moves nothing the reader can see,
     * so unlike the newer side this needs no scroll correction. No loop hides here either: a full
     * page is ~100 rows tall, far more than the margin, so landing one pushes the bottom well out
     * of range again.
     */
    if (
      element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_OLDER_EDGE &&
      older.hasMore &&
      !older.loadingMore &&
      !older.loading
    ) {
      older.loadMore();
    }
  }, [older.hasMore, older.loadingMore, older.loading, older.loadMore]);

  const backToTop = useCallback(() => {
    listRef.current?.scrollTo({ top: 0 });
    setAtTop(true);
  }, []);

  /*
   * The word on the append overlay, held in state rather than derived, for the fade-out's sake:
   * the overlay stays mounted and fades on opacity (nothing snaps), so for 150ms after a fetch
   * lands it is still faintly visible while both `loadingMore` flags are already false. Derived,
   * the word would flip to the other direction's the instant its own flag dropped — a scrim
   * saying "loading older lines" on its way out of a scroll-up. So the effect writes which way
   * the fetch in flight is walking and deliberately never clears it: the last true word is the
   * right thing to fade away with.
   */
  const [appendNote, setAppendNote] = useState<string | null>(null);
  const appending = newer.loadingMore || older.loadingMore;

  useEffect(() => {
    if (newer.loadingMore) setAppendNote(LOGS_TEXT.loadingNewer);
    else if (older.loadingMore) setAppendNote(LOGS_TEXT.loadingOlder);
  }, [newer.loadingMore, older.loadingMore]);

  /*
   * Live rows, the newer-chain, and the older-chain — three sources stacked newest-first and never
   * merged or de-duplicated with each other.
   *
   * The live tail cannot be merged into either chain: a row off the tail has `id: ""` — it was
   * committed but never read back, so it has no autoincrement value to match against, and
   * `refresh` is how it becomes one list with the search results again. The newer- and
   * older-chains need no such caveat — both come from the same paginated endpoint and both carry
   * real ids — but they stay two arrays anyway, because that is the seam the two scroll edges
   * push on independently: wheel-up at the top grows `newer`, reaching the bottom grows `older`.
   *
   * `live` and `state.anchor` are not expected to be true together — jumping turns `live` off, and
   * turning `live` back on drops the anchor (see `onToggleLive` below) — but the order here is
   * still the correct fallback if that guard is ever wrong: live is the most recent thing that
   * could exist, the newer-chain is the second-most, and the older-chain — always present — is the
   * rest of the list under both.
   */
  const items = useMemo<LogFeedItem[]>(() => {
    const liveItems = live ? shown : [];
    const newerItems = state.anchor ? newer.rows.map((row) => ({ kind: "row" as const, key: row.id, row })) : [];
    const olderItems = older.rows.map((row) => ({ kind: "row" as const, key: row.id, row }));
    return [...liveItems, ...newerItems, ...olderItems];
  }, [live, shown, state.anchor, newer.rows, older.rows]);

  /** Gaps are not selectable — a dropped-lines marker is a fact about the list, not a row in it. */
  const selectableKeys = useMemo(() => items.filter((item) => item.kind === "row").map((item) => item.key), [items]);

  /**
   * Where the cursor was, so it can be put back somewhere sensible when its row disappears.
   *
   * A key, once gone, says nothing about where in the list it used to be — so the index is kept
   * alongside it. This is what makes the clamp below land near where the reader was looking rather
   * than at the top.
   */
  const lastIndex = useRef(0);

  /*
   * §6: the selection is clamped whenever the list changes.
   *
   * Filters change the list under the cursor constantly — that is what filters are — and a
   * selection pointing at a row that is no longer there is not visibly broken: `⏎` and `⌥⏎` simply
   * stop doing anything, which reads as the keyboard having died. The tail makes it worse, since
   * the list also changes when nobody touched anything.
   */
  useEffect(() => {
    if (selectedKey === null) return;

    const index = selectableKeys.indexOf(selectedKey);
    if (index >= 0) {
      lastIndex.current = index;
      return;
    }

    /*
     * An empty list is left alone, and that is the whole of the fix.
     *
     * Changing a filter empties the list for the render between the query changing and its answer
     * arriving. Clearing the cursor there looks right and is not: by the time the rows land the
     * selection is already `null`, this effect returns early, and the cursor is gone for good —
     * a filter that narrows the list would drop the keyboard entirely, which is the exact failure
     * §6 asks about. Holding the stale key costs one render with nothing highlighted and restores
     * the cursor the moment there is a row to put it on.
     */
    if (selectableKeys.length === 0) return;

    setSelectedKey(selectableKeys[Math.min(lastIndex.current, selectableKeys.length - 1)] ?? null);
  }, [selectableKeys, selectedKey]);

  const move = useCallback(
    (delta: number) => {
      setSelectedKey((current) => {
        if (selectableKeys.length === 0) return null;

        const index = current === null ? -1 : selectableKeys.indexOf(current);
        // From no selection, `j` takes the first row and `k` the last — the two ends somebody
        // reaching for a keyboard is actually reaching for.
        if (index < 0) return selectableKeys[delta > 0 ? 0 : selectableKeys.length - 1] ?? null;

        // Clamped rather than wrapped: a list that jumps from the last line to the first while you
        // are holding `j` loses your place completely, and there is no undo for that.
        return selectableKeys[Math.min(Math.max(index + delta, 0), selectableKeys.length - 1)] ?? null;
      });
    },
    [selectableKeys],
  );

  /*
   * Follow the cursor with the scrollport.
   *
   * `block: "nearest"` so a row already on screen is left exactly where it is — clicking a row
   * would otherwise re-centre the list under the pointer, which is the sort of motion §3.4 rules
   * out. It only scrolls when the selection has genuinely gone out of view.
   */
  useEffect(() => {
    if (selectedKey === null) return;
    listRef.current?.querySelector(`[data-row-key="${CSS.escape(selectedKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  const selectedRow = useMemo<LogRow | null>(() => {
    const item = items.find((candidate) => candidate.kind === "row" && candidate.key === selectedKey);
    return item?.kind === "row" ? item.row : null;
  }, [items, selectedKey]);

  /*
   * The expanded row's own fetch — IKN-58.
   *
   * Here rather than in `RowDetail`, because the table opens no sockets: it is handed its rows, its
   * cursor and its selection, and this is the fourth of those. Keeping it here is also what lets
   * the pane be rendered in a test, or against a trace, without a server behind it.
   *
   * `useLogDetail` keys on the row's id and timestamp rather than on this object, which matters
   * precisely here: `items` is rebuilt on every tailed line, so the memo below yields a new object
   * several times a second while a live tail runs.
   */
  const expandedRow = useMemo<LogRow | null>(() => {
    const item = items.find((candidate) => candidate.kind === "row" && candidate.key === expandedKey);
    return item?.kind === "row" ? item.row : null;
  }, [items, expandedKey]);

  const detail = useLogDetail(expandedRow);

  const copyRow = useCallback(
    (row: LogRow) => {
      // NDJSON, not pretty JSON: the point of copying a line is to paste it into something that
      // reads a stream of them — jq, another Iknos, a scratch file.
      void navigator.clipboard.writeText(`${JSON.stringify(row)}\n`);
      toast.show(LOGS_TEXT.copied, "ok");
    },
    [toast],
  );

  const openInLogs = useCallback(
    (traceId: string) => {
      setValue("q", traceId);
      setOpenTraceId(null);
    },
    [setValue],
  );

  const copyId = useCallback(
    (traceId: string) => {
      void navigator.clipboard.writeText(traceId);
      toast.show(LOGS_TEXT.copied, "ok");
    },
    [toast],
  );

  /*
   * The keyboard table of §6, bound to the state that answers it (IKN-22).
   *
   * The listener itself is in the chrome and there is exactly one of it; these are handlers it
   * dispatches to while this view is mounted. A page with no list registers none of them and the
   * keys do nothing, which is the right behaviour rather than a missing feature.
   */
  useCommand("selection.next", () => move(1));
  useCommand("selection.prev", () => move(-1));
  useCommand("selection.open", () => {
    if (selectedKey !== null) setExpandedKey(selectedKey);
  });
  useCommand("selection.trace", () => {
    // Only for a row that has one. A line logged outside any request carries no `traceId`, and
    // opening an empty timeline for it would be answering a question it never asked.
    if (selectedRow?.traceId) setOpenTraceId(selectedRow.traceId);
  });
  useCommand("selection.copy", () => {
    if (selectedRow) copyRow(selectedRow);
  });

  /*
   * Three cells of the status bar, published rather than hoisted — see `viewStatus`.
   *
   * `count` is what is on screen for the window, which is the number the bar can honestly claim:
   * the total for the range would need a `COUNT(*)` over the same predicate, and IKN-19
   * deliberately does not run one (the extra row is how the page learns there is more).
   */
  usePublishViewStatus({ live, count: items.length, tookMs: older.tookMs });

  return (
    <section className="flex h-full min-h-0 flex-col bg-chassis-deep">
      <QueryBar
        state={state}
        services={services.map((service) => service.name)}
        onSetValue={setValue}
        onToggle={toggle}
        onClear={clear}
        live={live}
        onToggleLive={() => {
          setLive((current) => {
            const next = !current;
            // Turning LIVE back on always means fully live — an anchored window left standing
            // behind it would leave the newer-chain's scroll-to-top and the tail's own top-of-list
            // prepending both reaching for the same few pixels, each on its own idea of what
            // belongs there.
            if (next && state.anchor) unpinWindow();
            return next;
          });
        }}
        tookMs={older.tookMs}
        pinned={state.pinned}
        onUnpinWindow={unpinWindow}
        onJumpToTime={(at) => {
          jumpTo(at);
          // The jump is the point at which live and anchored stop being compatible — see the note
          // on `items` above for why the two are not expected to coexist.
          setLive(false);
        }}
        onRefresh={() => {
          refresh();
          older.reload();
          // Not `newer.reload()`: the newer chain fetches nothing except when the reader scrolls
          // up for it, and a reload cannot un-ask a question that was never asked.
          histogram.reload();
        }}
      />

      <VolumeHistogram
        histogram={histogram.histogram}
        loading={histogram.loading}
        error={histogram.error}
        onSelectBucket={setWindow}
        onRetry={histogram.reload}
      />

      {held > 0 && (
        <button
          type="button"
          onClick={backToTop}
          className="border-y border-chassis-border bg-chassis-raised px-3 py-1 text-label text-chassis-accent transition-[filter] duration-150 ease-out hover:brightness-110"
        >
          {LOGS_TEXT.newLines(held)} · {LOGS_TEXT.resume}
        </button>
      )}

      {/*
       * The stream's scroller, and the reason `ik-scroll-head` exists: the table's column headings
       * are `sticky` *inside* this box — which is what keeps them the same width as the rows
       * sliding under them — so without it the bar starts level with the titles and the thumb sits
       * across them, and the band stops 9px short of the edge where the rail was carved out.
       *
       * `HEAD_BAND` rather than `SURFACE_HEAD_BAND.chassis`: this table inverts the usual pair.
       * `DenseTable`'s band is inset into its rows; the stream's is `chassis-surface`, a step
       * *lighter* than the `chassis-inset` it sits above, so the headings read as chrome over the
       * stream rather than as its first line (`LogTable` has the long version). The ink the
       * gradient paints across the rail has to be the ink the cells beside it are painted with.
       *
       * `bg-chassis-inset` on the scroller, not only on the table inside it, so the strip beside
       * the rows is the stream's own ground and not the `chassis-deep` of the section behind.
       */}
      {/*
       * The wrapper exists for the overlay: an element absolutely positioned over the *viewport*
       * of the stream has to be a sibling of the scroller, not a child — inside, it would be laid
       * out against the ten-thousand-row scroll box and either scroll away or cover only the top
       * screenful. The scroller keeps every behaviour it had; only `flex-1 min-h-0` moves up here.
       */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          onWheel={onWheel}
          className={cn("ik-scroll ik-scroll-head h-full overflow-y-auto bg-chassis-inset", HEAD_BAND)}
        >
          <LogTable
            items={items}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onOpen={setExpandedKey}
            onOpenTrace={setOpenTraceId}
            loading={older.loading}
            hasMore={older.hasMore}
            loadingMore={older.loadingMore}
            error={older.error}
            onRetry={older.reload}
          />
        </div>

        {/*
         * The append scrim — a page is on its way in at one of the scroll edges (IKN-59).
         *
         * `chassis-deep` at 0.9, not the zone dim's own 0.6: that recipe is tuned to leave the
         * rows underneath legible through a 180ms flash, and the point here is the opposite one —
         * this stands in *for* the rows while they are mid-reflow, so it has to read as opaque
         * rather than as a tint. `z-[44]`: above the lifted time handles at 40, or ten thousand
         * bright timestamps would punch through it, and below the heading band at 45, which stays
         * crisp because it is chrome over the stream rather than the stream. Always mounted, faded
         * on opacity — an unmounted overlay cannot animate its exit, and these fetches are short
         * enough that the exit is most of what is ever seen of it.
         *
         * The word is `text-title` — the size this house uses for a screen's own heading — because
         * at the row grid's own `text-row` it read as another line of log rather than as the
         * reason the log stopped moving for a moment.
         *
         * `aria-hidden`, deliberately: it is a visual echo of state, not the state's announcement.
         * The newer edge is wheel-only today (the known IKN-59 gap), and the older edge's fetch
         * announces itself in the footer strip a screen reader already had.
         */}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 z-[44] flex items-center justify-center bg-chassis-deep/90 transition-opacity duration-150 ease-out",
            appending ? "opacity-100" : "opacity-0",
          )}
        >
          {appendNote !== null && (
            <span className="rounded-chip border border-chassis-border-strong bg-chassis-surface px-4 py-3 text-title text-chassis-text">
              <Pending>{appendNote}</Pending>
            </span>
          )}
        </div>
      </div>

      {/*
       * Mounted for the whole session, never `{openTraceId && …}` — which is what it was until
       * IKN-53, and what made two of its own guarantees false.
       *
       * `TraceTimeline` derives its `open` from the trace precisely so the element can stay put:
       * a `<dialog>` returns focus to whatever opened it when it closes, and a node torn down in
       * the same frame takes that with it — the reader lands at the top of the document instead of
       * on the row they came from, which its own comment says is the difference between the modal
       * being usable and being a trap. Since IKN-53 it costs the exit as well: unmounting on close
       * is exactly the case `allow-discrete` cannot save, because there is no longer an element to
       * hold. The timeline vanished where every other modal leaves.
       *
       * It costs nothing to leave mounted: `useTrace(null)` fetches nothing, and `TraceBody`
       * returns `null` with no trace, no request and no failure.
       */}
      <TraceTimeline
        trace={trace.trace}
        loading={trace.loading}
        error={trace.error}
        onClose={() => setOpenTraceId(null)}
        onOpenInLogs={openInLogs}
        onCopyId={copyId}
      />

      {/* Same reasoning as `TraceTimeline` above — mounted for the session, `open` derived from
          `expandedRow` rather than kept as a state of its own, so closing it does not throw away
          the `<dialog>`'s own focus return (IKN-60). */}
      <RowDetail
        row={expandedRow}
        state={detail}
        onClose={() => setExpandedKey(null)}
        onOpenTrace={setOpenTraceId}
        onCopy={copyRow}
      />
    </section>
  );
};
