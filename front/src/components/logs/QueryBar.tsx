"use client";

import { Badge } from "@components/ui/Badge";
import { Button } from "@components/ui/Button";
import { Field } from "@components/ui/Field";
import { Select } from "@components/ui/Select";
import { isFilterActive, LOG_FILTER_KEYS } from "@lib/logQuery";
import { FILTERABLE_LEVELS } from "@lib/logTypes";
import { cn } from "@lib/utils";
import { LOGS_TEXT } from "@text/logs";
import { useEffect, useId, useRef, useState } from "react";

import type { LogFilterKey, LogQueryState } from "@lib/logQuery";

/**
 * The token query bar — IKN-12 §1, design doc §5.1 item 1.
 *
 * **Presentational, deliberately.** It renders the filter state it is handed and calls back; the
 * URL, the fetching and the tail all live above it in `useLogQueryState`. That split is what lets
 * the bar be driven from a fixture — and it is also the honest shape, because the same filter set
 * feeds three endpoints and none of them belong to a bar.
 *
 * It is the top edge of the **dark** log window inset into the light work surface (§U3: the log
 * stream is the one place you are genuinely in a terminal), so everything here is `chassis-*` and
 * every primitive is handed `surface="chassis"`.
 */

/** A filter being composed, before it becomes a chip. Never more than one at a time — see `Drawer`. */
type Draft = { key: LogFilterKey; value: string };

/**
 * `level` is a **minimum** on the API, so the bare name lies.
 *
 * `level:warn` reads as "warnings" and quietly hides that the same query is also returning every
 * error and fatal under it — the exact misreading that makes someone believe a service is calm.
 * `≥ warn` costs two characters and cannot be misread.
 */
const levelLabel = (level: string) => `≥ ${level}`;

const displayValue = (key: LogFilterKey, value: string) => (key === "level" ? levelLabel(value) : value);

export const QueryBar = ({
  state,
  services,
  onSetValue,
  onToggle,
  onClear,
  live,
  onToggleLive,
  tookMs,
  pinned,
  onUnpinWindow,
  onRefresh,
}: {
  state: LogQueryState;
  services: string[];
  onSetValue: (key: LogFilterKey, value: string | null) => void;
  onToggle: (key: LogFilterKey) => void;
  onClear: (key: LogFilterKey) => void;
  live: boolean;
  onToggleLive: () => void;
  tookMs: number | null;
  /** The window came from a histogram click. A separate prop from `state.pinned`: the bar renders
      what it is handed rather than deciding, and the two are the same value in the real view. */
  pinned: boolean;
  onUnpinWindow: () => void;
  onRefresh: () => void;
}) => {
  const labelId = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * `service` is dropped from the addable set when the registry is empty rather than offered as a
   * select with nothing in it: an empty dropdown is a dead end that reads like a loading bug, and
   * the rail is the other place this key gets set anyway.
   */
  const unset = LOG_FILTER_KEYS.filter((key) => !state.values[key] && (key !== "service" || services.length > 0));

  /**
   * The key being composed stays in its own dropdown even once it is no longer "unset" — the rail
   * writes `service` too (`@lib/chassisState`), so a value can arrive from outside mid-compose, and
   * a `<select>` whose value is absent from its options renders as some other key silently.
   */
  const keyOptions = draft && !unset.includes(draft.key) ? [draft.key, ...unset] : unset;

  /** Closed sets open on their first option, so the drawer is submittable the moment it appears. */
  const seedFor = (key: LogFilterKey): string =>
    key === "service" ? (services[0] ?? "") : key === "level" ? FILTERABLE_LEVELS[0] : "";

  const commit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const value = draft.value.trim();
    // Belt and braces with the `pattern` on the free-text control. `required` alone only rejects
    // the empty string, so `"   "` used to reach here, trim to nothing, and return — leaving the
    // drawer open with no message, which reads as the button being broken.
    if (!value) return;
    onSetValue(draft.key, value);
    setDraft(null);
  };

  return (
    <div className="flex flex-col gap-1.5 border-b border-chassis-border bg-chassis-surface px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span
          id={labelId}
          className="text-kicker tracking-kicker text-chassis-text-dim uppercase"
        >
          {LOGS_TEXT.filtersLabel}
        </span>

        <ul
          ref={listRef}
          aria-labelledby={labelId}
          className="flex flex-wrap items-center gap-1.5"
        >
          {LOG_FILTER_KEYS.map((key) => {
            const value = state.values[key];
            if (!value) return null;

            return (
              <li key={key}>
                <FilterChip
                  name={LOGS_TEXT.filterNames[key]}
                  value={displayValue(key, value)}
                  active={isFilterActive(state, key)}
                  onToggle={() => onToggle(key)}
                  onRemove={() => onClear(key)}
                />
              </li>
            );
          })}
        </ul>

        {/*
         * The trigger is *replaced* by the drawer rather than sitting above it as a disclosure. Two
         * controls reading "add filter" in the same bar — one to open, one to commit — is a pair a
         * screen reader cannot tell apart, and the copy offers only the one word for both.
         */}
        {/* Opening is a pointer action, so closing has to be one too — see `Drawer`'s cancel. */}
        {!draft && unset.length > 0 && (
          <Button
            ref={triggerRef}
            variant="quiet"
            onClick={() => setDraft({ key: unset[0], value: seedFor(unset[0]) })}
            className="h-6 px-2"
          >
            + {LOGS_TEXT.addFilter}
          </Button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {pinned && (
            <>
              <Badge
                tone="info"
                surface="chassis"
              >
                {LOGS_TEXT.pinnedWindow}
              </Badge>
              {/*
               * Without this, clicking a histogram bucket is a one-way door: the range buttons go on
               * writing `range` while an explicit `from`/`to` outranks them, so they look broken.
               */}
              <Button
                variant="quiet"
                onClick={onUnpinWindow}
                className="h-6 px-2"
              >
                {LOGS_TEXT.unpinWindow}
              </Button>
            </>
          )}

          {/*
           * The one number that makes a query degrading over weeks visible while it is still cheap
           * to fix. Rendered only when a query has actually reported one — a `q 0ms` before the
           * first response is a claim nobody measured.
           */}
          {tookMs !== null && <span className="text-kicker tracking-control text-chassis-text-dim">q {tookMs}ms</span>}

          <Button
            variant="quiet"
            onClick={onRefresh}
            className="h-6 px-2"
          >
            {LOGS_TEXT.refresh}
          </Button>

          <LiveToggle
            live={live}
            onToggle={onToggleLive}
          />

          {/*
           * No `⌘L fullscreen`, which the mockup draws here. The shortcut layer is IKN-22 and a
           * control that is present but inert is the one thing this project refuses: what it cannot
           * answer is absent, not greyed out. It joins this cluster when the binding exists.
           */}
        </div>
      </div>

      {draft && (
        <Drawer
          draft={draft}
          keyOptions={keyOptions}
          services={services}
          onChange={setDraft}
          onSeed={seedFor}
          onSubmit={commit}
          onCancel={() => setDraft(null)}
          returnFocusTo={triggerRef}
          fallbackFocusTo={listRef}
        />
      )}
    </div>
  );
};

/**
 * A filter as a token, with a toggle **and** a remove.
 *
 * Not `ui/Chip`, and this is the one substitution worth explaining. The primitive has a single
 * control and draws it as `×`, meaning *remove*; here `×` is the **toggle** — off, not gone — so
 * reusing it would give one glyph two meanings inside the same bar, and the second control would
 * still have nowhere to live. Everything else is the primitive: its shape, its tokens, its
 * dim-key/bright-value split, so a chip here and a chip on a card are the same object. If anything
 * else ever needs the two-control form, it moves into `ui/Chip` and this disappears.
 *
 * Off is drawn with `opacity-60`, the same way the rail dims a paused service, and it **keeps its
 * value** — "see it without the service filter", then back, without retyping. That is the whole
 * design (IKN-12 §1) and the reason `@lib/logQuery` models "off" as a separate `off=` list instead
 * of clearing the parameter.
 *
 * Remove says `rm` rather than a second symbol: `×` and `+` are spent on the toggle, and a third
 * glyph at 10px would be a guess for the reader — in a terminal window the word is the shortest
 * unambiguous thing available. Both controls carry a real name, because a bare glyph is not one.
 */
const FilterChip = ({
  name,
  value,
  active,
  onToggle,
  onRemove,
}: {
  name: string;
  value: string;
  active: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-chip border border-chassis-border-strong bg-chassis-inset px-1.5 py-0.5 text-row",
      !active && "opacity-60",
    )}
  >
    <span className="text-chassis-text-dim">{name}:</span>
    <span className="text-chassis-text">{value}</span>
    {/*
     * The names carry `name:value`, not just the verb. Five chips otherwise produce ten buttons
     * with two names between them, and `aria-label` suppresses the very text beside it that would
     * have told them apart. The toggle's name stays *stable* across states — `aria-pressed` is
     * what changes — because a name that rewrites itself reads as two different controls.
     */}
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={`${name}:${value}`}
      title={active ? LOGS_TEXT.filterOn : LOGS_TEXT.filterOff}
      className="ml-0.5 px-0.5 leading-none text-chassis-text-dim hover:text-chassis-text"
    >
      {active ? "×" : "+"}
    </button>
    <button
      type="button"
      onClick={onRemove}
      aria-label={`${LOGS_TEXT.removeFilter} — ${name}:${value}`}
      title={LOGS_TEXT.removeFilter}
      className="px-0.5 text-kicker leading-none text-chassis-text-dim hover:text-chassis-text"
    >
      rm
    </button>
  </span>
);

/**
 * The compose drawer — a row, not a modal.
 *
 * A modal to add `status:500` would be four keystrokes of ceremony around one, and it would cover
 * the very rows the filter is being aimed at. It sits under the chip row rather than inside it so
 * that opening it grows the bar by a line instead of shuffling the chips and the live toggle
 * sideways.
 *
 * Focus is handed to the key select on open and back to whatever opened it on close, because the
 * chassis is keyboard-first (§U5) and a drawer that dumps focus on `<body>` when it closes sends
 * the next Tab to the top of the document. The fallback matters at the far edge: with all five
 * filters set there is nothing left to add, so the trigger is gone by the time focus comes back and
 * the chip list takes it instead.
 */
const Drawer = ({
  draft,
  keyOptions,
  services,
  onChange,
  onSeed,
  onSubmit,
  onCancel,
  returnFocusTo,
  fallbackFocusTo,
}: {
  draft: Draft;
  keyOptions: LogFilterKey[];
  services: string[];
  onChange: (draft: Draft) => void;
  onSeed: (key: LogFilterKey) => string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  returnFocusTo: React.RefObject<HTMLButtonElement | null>;
  fallbackFocusTo: React.RefObject<HTMLUListElement | null>;
}) => {
  const keyRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    keyRef.current?.focus();

    return () => {
      const fallback = fallbackFocusTo.current?.querySelector<HTMLButtonElement>("button");
      (returnFocusTo.current ?? fallback)?.focus();
    };
  }, [returnFocusTo, fallbackFocusTo]);

  const closedSet = draft.key === "service" || draft.key === "level";

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        // Escape abandons the draft, and stops there: a log row is expanded and a trace modal is
        // open above this view, and both close on Escape too. Whichever is innermost wins.
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onCancel();
      }}
      className="flex flex-wrap items-end gap-2 rounded-control border border-chassis-border bg-chassis-inset px-2 py-1.5"
    >
      <Select
        ref={keyRef}
        surface="chassis"
        label={LOGS_TEXT.addFilter}
        value={draft.key}
        onChange={(event) => {
          const key = event.target.value as LogFilterKey;
          onChange({ key, value: onSeed(key) });
        }}
        options={keyOptions.map((key) => ({ value: key, label: LOGS_TEXT.filterNames[key] }))}
        className="w-[112px]"
      />

      {closedSet ? (
        <Select
          surface="chassis"
          label={LOGS_TEXT.filterNames[draft.key]}
          value={draft.value}
          onChange={(event) => onChange({ key: draft.key, value: event.target.value })}
          options={
            draft.key === "service"
              ? services.map((service) => ({ value: service, label: service }))
              : FILTERABLE_LEVELS.map((level) => ({ value: level, label: levelLabel(level) }))
          }
          className="w-[184px]"
        />
      ) : (
        <Field
          surface="chassis"
          label={LOGS_TEXT.filterNames[draft.key]}
          value={draft.value}
          onChange={(event) => onChange({ key: draft.key, value: event.target.value })}
          required
          // `required` alone accepts `"   "`. This makes the browser demand a non-space character,
          // so the refusal comes with its own message instead of a submit that quietly does nothing.
          // A JSX string attribute is not a JS string literal — it does no escape processing, so
          // this is one backslash, not two, and reads as "contains a non-space character".
          pattern=".*\S.*"
          autoComplete="off"
          spellCheck={false}
          className="w-[184px]"
        />
      )}

      <Button
        type="submit"
        variant="quiet"
        className="h-7 px-2"
      >
        {LOGS_TEXT.addFilter}
      </Button>

      {/*
       * Escape is not enough on its own. The drawer *replaces* the trigger that opened it, so
       * without this a pointer user who opens it by accident has no way back and the bar just
       * stays a row taller. `type="button"` so it cannot submit the form it sits in.
       */}
      <Button
        type="button"
        variant="quiet"
        onClick={onCancel}
        className="h-7 px-2"
      >
        {LOGS_TEXT.close}
      </Button>
    </form>
  );
};

/**
 * `● LIVE` / `❙❙ PAUSED`.
 *
 * A toggle button with a stable name and `aria-pressed`, rather than a label that rewrites itself:
 * the state is what a reader needs, and "pressed" carries it once instead of the name meaning two
 * different things at two different times.
 *
 * The dot is decoration here, not a `ui/Dot` — that primitive is a labelled `role="img"` by
 * construction, and inside a button its label would be glued onto the button's own name. The button
 * says LIVE in words already, which is also the answer for anyone who cannot separate the hues.
 *
 * `animate-pulse-live` is the house's one liveness animation and it is what distinguishes a page
 * that is receiving from a page that has frozen; `prefers-reduced-motion` stills it globally
 * (`styles/animations.css`), and the word beside it keeps saying the same thing.
 *
 * The hint is `liveHint` in both states on purpose. `pausedHint` describes the list holding new
 * lines because you scrolled away — that is the stream's state, not this toggle's, and putting it
 * here would claim a reason that is often untrue.
 */
const LiveToggle = ({ live, onToggle }: { live: boolean; onToggle: () => void }) => (
  <Button
    variant="quiet"
    onClick={onToggle}
    aria-pressed={live}
    title={LOGS_TEXT.liveHint}
    className={cn("h-6 gap-1.5 px-2", live && "border-chassis-accent text-chassis-accent hover:text-chassis-accent")}
  >
    {live ? (
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse-live rounded-full bg-chassis-accent"
      />
    ) : (
      <span aria-hidden>❙❙</span>
    )}
    {live ? LOGS_TEXT.live : LOGS_TEXT.paused}
  </Button>
);
