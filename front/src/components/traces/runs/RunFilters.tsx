"use client";

import { Select } from "@components/ui/Select";
import { shortModel } from "@lib/aiRunFormat";
import { useSelectedService } from "@lib/chassisState";
import { CHECKS, REVIEW } from "@lib/interfaces/aiRunTypes";
import { TRACES_TEXT } from "@text/traces";

import type { Option } from "@components/ui/Select";
import type { AiRunList, Checks, Review, RunFilterState } from "@lib/interfaces/aiRunTypes";
import type { RangeKey } from "@lib/timeRange";

/** The empty option every select starts with: no filter. */
const ANY = "";

const anyOption = (label: string): Option => ({ value: ANY, label });

const CHECK_OPTIONS: Option[] = [
  anyOption(TRACES_TEXT.any),
  ...Object.values(CHECKS).map((value) => ({ value, label: TRACES_TEXT.checks[value] })),
];

const REVIEW_OPTIONS: Option[] = [
  anyOption(TRACES_TEXT.any),
  ...Object.values(REVIEW).map((value) => ({ value, label: TRACES_TEXT.review[value] })),
];

const orNull = (value: string): string | null => (value === ANY ? null : value);

/**
 * The run list's heading and filters (IKN-91). The service select *is* the rail's selection — the
 * same state, so the two can never disagree; the range is the top bar's. The prompt and model
 * selects offer what the window holds, read from every run rather than the filtered ones, so a
 * filter can always be undone from its own select.
 */
export const RunFilters = ({ list, range, filters, onChange }: RunFiltersProps) => {
  const [service, setService] = useSelectedService();
  const facets = list?.facets ?? { services: [], prompts: [], models: [] };
  const anyFilter = Object.values(filters).some((value) => value !== null);

  const services: Option[] = [
    anyOption(TRACES_TEXT.allServices),
    ...facets.services.map((name) => ({ value: name, label: name })),
  ];
  // A selection the window no longer holds stays selectable, so the select never lies about it.
  if (service !== null && !facets.services.includes(service)) services.push({ value: service, label: service });

  const prompts: Option[] = [anyOption(TRACES_TEXT.any), ...facets.prompts.map((p) => ({ value: p, label: p }))];
  const models: Option[] = [
    anyOption(TRACES_TEXT.any),
    ...facets.models.map((model) => ({ value: model, label: shortModel(model) })),
  ];

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-sans text-ui font-medium text-work-text">{TRACES_TEXT.listTitle}</h1>
        {list !== null && (
          <span className="text-row text-work-text-dim">
            {TRACES_TEXT.listScope(list.total, facets.services.length, range)}
          </span>
        )}
      </div>
      <form
        aria-label={TRACES_TEXT.filtersLabel}
        className="flex flex-wrap items-end gap-2.5"
        onSubmit={(event) => event.preventDefault()}
      >
        <Select
          label={TRACES_TEXT.filterService}
          options={services}
          value={service ?? ANY}
          onChange={(event) => setService(orNull(event.target.value))}
          className="w-filter"
          data-testid="filter-service"
        />
        <Select
          label={TRACES_TEXT.filterChecks}
          options={CHECK_OPTIONS}
          value={filters.checks ?? ANY}
          onChange={(event) => onChange({ ...filters, checks: orNull(event.target.value) as Checks | null })}
          className="w-filter"
          data-testid="filter-checks"
        />
        <Select
          label={TRACES_TEXT.filterReview}
          options={REVIEW_OPTIONS}
          value={filters.review ?? ANY}
          onChange={(event) => onChange({ ...filters, review: orNull(event.target.value) as Review | null })}
          className="w-filter"
          data-testid="filter-review"
        />
        <Select
          label={TRACES_TEXT.filterPrompt}
          options={prompts}
          value={filters.prompt ?? ANY}
          onChange={(event) => onChange({ ...filters, prompt: orNull(event.target.value) })}
          className="w-filter"
          data-testid="filter-prompt"
        />
        <Select
          label={TRACES_TEXT.filterModel}
          options={models}
          value={filters.model ?? ANY}
          onChange={(event) => onChange({ ...filters, model: orNull(event.target.value) })}
          className="w-filter"
          data-testid="filter-model"
        />
        <button
          type="button"
          disabled={!anyFilter}
          onClick={() => onChange({ checks: null, review: null, prompt: null, model: null })}
          className="h-7 rounded-control border border-work-border-strong px-3 text-dense text-work-text transition-[background-color,color,opacity] duration-150 ease-out hover:bg-work-inset disabled:opacity-50"
          data-testid="filters-reset"
        >
          {TRACES_TEXT.reset}
        </button>
      </form>
    </>
  );
};

type RunFiltersProps = {
  list: AiRunList | null;
  range: RangeKey;
  filters: RunFilterState;
  onChange: (filters: RunFilterState) => void;
};
