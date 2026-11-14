"use client";

import { CHASSIS_TEXT } from "@text/chassis";

/**
 * The rail's search field — between the `services` heading and the `all` row, outside the scroller
 * so it stays put while the list moves under it.
 *
 * It narrows the list and nothing else: the selection, the address and every view are untouched, so
 * a service that is selected and typed away is still the scope — the breadcrumb says so.
 *
 * `esc` empties it, and leaves it once it is empty: the first press undoes the typing, the second
 * hands the keyboard back to the page (`j`/`k` do nothing while a field has the letters).
 *
 * Gone below `--breakpoint-rail`, where 52px cannot hold a field. `ServiceRail` keeps the query in
 * state, so the list stays narrowed across a resize rather than jumping back.
 */
export const RailSearch = ({ query, onChange }: RailSearchProps) => {
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    if (query === "") event.currentTarget.blur();
    else onChange("");
  };

  return (
    <div className="relative mb-1 flex-none max-rail:hidden">
      <input
        type="text"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={CHASSIS_TEXT.railSearchPlaceholder}
        aria-label={CHASSIS_TEXT.railSearchLabel}
        autoComplete="off"
        spellCheck={false}
        data-testid="rail-search"
        className="w-full rounded-chip border border-chassis-border-strong bg-chassis-inset py-1 pr-6 pl-2 text-label text-chassis-text-bright outline-none transition-colors duration-150 ease-out placeholder:text-chassis-text-dim focus:border-chassis-accent"
      />
      {/* Always mounted, so it fades rather than pops; inert while there is nothing to clear. */}
      <button
        type="button"
        onClick={() => onChange("")}
        disabled={query === ""}
        aria-label={CHASSIS_TEXT.railSearchClear}
        data-testid="rail-search-clear"
        className="absolute inset-y-0 right-0 flex w-6 items-center justify-center text-label text-chassis-text-dim transition-[color,opacity] duration-150 ease-out hover:text-chassis-text disabled:pointer-events-none disabled:opacity-0"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
};

type RailSearchProps = {
  query: string;
  onChange: (query: string) => void;
};
