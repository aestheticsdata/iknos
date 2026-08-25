"use client";

import { Modal } from "@components/ui/Modal";
import { Pending } from "@components/ui/Pending";
import { useSelectedService } from "@lib/chassisState";
import { usePalette } from "@lib/commandState";
import { useOpenIssue } from "@lib/issueState";
import { useLogQueryState } from "@lib/logQuery";
import { LOG_QUERY_VIEWS, ROUTES } from "@lib/routes";
import { useOpenTrace } from "@lib/traceState";
import { usePaletteSearch } from "@lib/usePaletteSearch";
import { cn } from "@lib/utils";
import { CHASSIS_TEXT } from "@text/chassis";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SearchHit, SearchHitType } from "@lib/searchTypes";

/**
 * The ⌘K palette (IKN-22 §2).
 *
 * **A result is an action, not a link.** Choosing a service re-scopes every view, a route filters
 * the log list, a trace opens its timeline, a view navigates. That is why nothing here renders an
 * `<a>`: the four do genuinely different things, and dressing them as links would promise a
 * uniformity the palette does not have.
 *
 * Views are contributed locally rather than fetched. The set of them is this application's own
 * routing table — the server has no business knowing it, and "go to logs" should not cost a round
 * trip. `ISSUE` joined the other four with IKN-14, which is the ticket that gave it rows.
 */

/**
 * The views the palette can reach, in the rail's own order — and it has to stay in step with the
 * rail's list, or a view exists in one place and not the other.
 *
 * Contributed by the front rather than by `/api/search`: the set of views is this app's routing
 * table, not data, and asking the server for it would spend a round trip on "go to logs" (§4).
 */
const VIEWS: { label: string; href: string }[] = [
  { label: CHASSIS_TEXT.viewLogs, href: ROUTES.logs },
  { label: CHASSIS_TEXT.viewIssues, href: ROUTES.issues },
];

/** The word on the right of a row: what pressing enter will do. */
const ACTION: Record<SearchHitType, string> = {
  service: CHASSIS_TEXT.paletteScope,
  route: CHASSIS_TEXT.paletteFilter,
  trace: CHASSIS_TEXT.paletteOpen,
  issue: CHASSIS_TEXT.paletteIssue,
  view: CHASSIS_TEXT.paletteGo,
};

export const CommandPalette = () => {
  const { open, hide } = usePalette();
  const [term, setTerm] = useState("");
  const [cursor, setCursor] = useState(0);

  const { state, setValue } = useLogQueryState();
  const [, selectService] = useSelectedService();
  const openTrace = useOpenTrace();
  const [, openIssue] = useOpenIssue();
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);

  const { hits, loading, failed } = usePaletteSearch(term, state.bounds, open);

  /*
   * Views are matched here, on the same term, and always come last.
   *
   * Last because they are the least specific thing the term can mean: someone typing `logs` while
   * a service is called `logs-api` wants the service, and a navigation that stole the first row
   * would fire on enter before they had read the list.
   */
  const results = useMemo<SearchHit[]>(() => {
    const needle = term.trim().toLowerCase();
    const views: SearchHit[] =
      needle.length === 0
        ? []
        : VIEWS.filter((view) => view.label.toLowerCase().includes(needle)).map((view) => ({
            type: "view" as const,
            label: view.label,
            value: view.href,
            hint: null,
          }));

    return [...hits, ...views];
  }, [hits, term]);

  /*
   * The cursor is clamped whenever the list changes — the same rule §6 states for the log
   * selection, and the same failure if it is missed: a term that narrows the list to one row would
   * otherwise leave enter firing on a row that is no longer there.
   */
  useEffect(() => {
    setCursor((current) => (results.length === 0 ? 0 : Math.min(current, results.length - 1)));
  }, [results.length]);

  /* Opening starts from a clean box. A palette that reopens on the last search is a palette that
     answers a question from ten minutes ago. */
  useEffect(() => {
    if (!open) return;
    setTerm("");
    setCursor(0);
  }, [open]);

  const act = (hit: SearchHit) => {
    hide();

    switch (hit.type) {
      case "service":
        // Through `useSelectedService`, which also switches the filter back on (IKN-35) — the
        // whole reason that invariant lives in the hook rather than in the rail.
        selectService(hit.value);
        break;
      case "route":
        setValue("route", hit.value);
        break;
      case "trace":
        openTrace(hit.value);
        break;
      case "issue":
        // The value is a fingerprint, and the modal that answers it hangs off the chassis — so
        // this works from every view and needs no navigation at all (IKN-14).
        openIssue(hit.value);
        break;
      case "view":
        router.push(hit.value);
        break;
    }

    // A hit that acts on the log query is only visible on a view that reads it — the log panel at
    // full width, or the service view that embeds it (IKN-13). Reached from anywhere else, the
    // palette takes you where the answer is rather than silently setting a filter on a page that
    // does not read it.
    //
    // `issue` is exempt for the reason above: its modal is mounted on the chassis and opens over
    // whatever is on screen. Without the exemption, picking an issue *from the issues page* would
    // eject the reader to the log view — which is the one place that hit is least useful.
    const needsLogView = hit.type !== "view" && hit.type !== "issue";
    if (needsLogView && !LOG_QUERY_VIEWS.includes(pathname.replace(/\/+$/, ""))) router.push(ROUTES.logs);
  };

  /*
   * Focused explicitly rather than with `autoFocus`.
   *
   * `Modal` keeps its children mounted and drives the native dialog with `showModal()`, so the
   * input mounts once — at page load, with the palette closed — and React's `autoFocus` fires
   * exactly then and never again. The palette would open with the caret nowhere.
   */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((n) => (n + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((n) => (n - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = results[cursor];
      if (hit) act(hit);
    }
  };

  return (
    <Modal
      open={open}
      onClose={hide}
      tag={CHASSIS_TEXT.paletteTag}
      title={CHASSIS_TEXT.paletteTitle}
      hint={CHASSIS_TEXT.paletteHint}
    >
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={CHASSIS_TEXT.palettePlaceholder}
          aria-label={CHASSIS_TEXT.paletteTitle}
          /* The global listener suppresses every shortcut while focus is in a field, so the arrows
             and enter above are the palette's alone and cannot also move the log selection. */
          className="w-full rounded-chip border border-chassis-border-strong bg-chassis-inset px-2 py-1.5 text-ui text-chassis-text-bright outline-none transition-colors duration-150 ease-out placeholder:text-chassis-text-dim focus:border-chassis-accent"
        />

        {results.length > 0 ? (
          <ul className="ik-scroll flex max-h-[320px] flex-col overflow-y-auto">
            {results.map((hit, index) => (
              <Row
                key={`${hit.type}:${hit.value}`}
                hit={hit}
                active={index === cursor}
                onHover={() => setCursor(index)}
                onPick={() => act(hit)}
              />
            ))}
          </ul>
        ) : (
          <p className="px-1 py-2 text-row text-chassis-text-dim">
            {failed ? (
              CHASSIS_TEXT.paletteFailed
            ) : loading ? (
              <Pending>{CHASSIS_TEXT.paletteSearching}</Pending>
            ) : term.trim().length === 0 ? (
              CHASSIS_TEXT.palettePrompt
            ) : (
              CHASSIS_TEXT.paletteEmpty
            )}
          </p>
        )}
      </div>
    </Modal>
  );
};

const Row = ({
  hit,
  active,
  onHover,
  onPick,
}: {
  hit: SearchHit;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) => (
  <li>
    <button
      type="button"
      onClick={onPick}
      onMouseMove={onHover}
      /* The keyboard owns the cursor and the mouse follows it, rather than the two keeping separate
         highlights — the row under enter and the row under the pointer must be the same row. */
      className={cn(
        "flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left text-row transition-colors duration-150 ease-out",
        active ? "bg-chassis-raised text-chassis-text-bright" : "text-chassis-text-muted",
      )}
    >
      <span className="w-[54px] shrink-0 text-kicker tracking-kicker text-chassis-text-dim uppercase">{hit.type}</span>
      <span className="min-w-0 flex-1 truncate">{hit.label}</span>
      {hit.hint && <span className="shrink-0 text-micro text-chassis-text-dim">{hit.hint}</span>}
      <span className="w-[46px] shrink-0 text-right text-kicker tracking-control text-chassis-text-dim">
        {ACTION[hit.type]}
      </span>
    </button>
  </li>
);
