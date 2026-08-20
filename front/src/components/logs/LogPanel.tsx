"use client";

import { LogTable } from "@components/logs/LogTable";
import { QueryBar } from "@components/logs/QueryBar";
import { TraceTimeline } from "@components/logs/TraceTimeline";
import { VolumeHistogram } from "@components/logs/VolumeHistogram";
import { useToast } from "@components/ui/Toast";
import { useLogQueryState } from "@lib/logQuery";
import { useHistogram } from "@lib/useHistogram";
import { useLiveTail } from "@lib/useLiveTail";
import { useLogSearch } from "@lib/useLogSearch";
import { useTrace } from "@lib/useTrace";
import { LOGS_TEXT } from "@text/logs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LogFeedItem, LogRow } from "@lib/logTypes";
import type { Service } from "@lib/services";

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
  const { state, setValue, toggle, clear, setWindow, unpinWindow, refresh } = useLogQueryState();

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
  const [openTraceId, setOpenTraceId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const search = useLogSearch(state);
  const histogram = useHistogram(state);
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

  const onScroll = useCallback(() => {
    const element = listRef.current;
    if (element) setAtTop(element.scrollTop <= 0);
  }, []);

  const backToTop = useCallback(() => {
    listRef.current?.scrollTo({ top: 0 });
    setAtTop(true);
  }, []);

  /*
   * Live rows sit above the searched page, and the two are never merged or de-duplicated.
   *
   * They cannot be: a row off the tail has `id: ""` — it was committed but never read back, so it
   * has no autoincrement value to match against. Attempting a merge would mean guessing identity
   * from `(ts, service, message)`, and two identical lines a millisecond apart are exactly what a
   * loop in someone's code looks like. The tail is what arrived since the page was fetched;
   * `refresh` is how the two become one list again.
   */
  const items = useMemo<LogFeedItem[]>(
    () => [...(live ? shown : []), ...search.rows.map((row) => ({ kind: "row" as const, key: row.id, row }))],
    [live, shown, search.rows],
  );

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

  return (
    <section className="flex h-full min-h-0 flex-col bg-chassis-deep">
      <QueryBar
        state={state}
        services={services.map((service) => service.name)}
        onSetValue={setValue}
        onToggle={toggle}
        onClear={clear}
        live={live}
        onToggleLive={() => setLive((current) => !current)}
        tookMs={search.tookMs}
        pinned={state.pinned}
        onUnpinWindow={unpinWindow}
        onRefresh={() => {
          refresh();
          search.reload();
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
          className="border-y border-chassis-border bg-chassis-raised px-3 py-1 text-label text-chassis-accent hover:brightness-110"
        >
          {LOGS_TEXT.newLines(held)} · {LOGS_TEXT.resume}
        </button>
      )}

      <div
        ref={listRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <LogTable
          items={items}
          selectedKey={selectedKey}
          expandedKey={expandedKey}
          onSelect={setSelectedKey}
          onExpand={setExpandedKey}
          onOpenTrace={setOpenTraceId}
          loading={search.loading}
          hasMore={search.hasMore}
          loadingMore={search.loadingMore}
          onLoadMore={search.loadMore}
          error={search.error}
          onRetry={search.reload}
          onCopyRow={copyRow}
        />
      </div>

      {openTraceId && (
        <TraceTimeline
          trace={trace.trace}
          loading={trace.loading}
          error={trace.error}
          onClose={() => setOpenTraceId(null)}
          onOpenInLogs={openInLogs}
          onCopyId={copyId}
        />
      )}
    </section>
  );
};
