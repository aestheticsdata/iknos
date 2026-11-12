import { CHECKS, REVIEW } from "@contracts/ai-runs";
import { BadRequestException } from "@nestjs/common";

import type { Checks, Review } from "@contracts/ai-runs";
import type { RunFilterQuery, RunFilters } from "../interfaces/ai-run-types";

/** The AI-run routes' query strings, parsed by hand like every route here (no `transform` pipe). Pure. */

/** The longest prompt or model name a filter may carry — a model column is 128, a prompt `<node>@v<n>`. */
const MAX_FILTER_CHARS = 255;

/** The quality chart's span: the production retention, so the series never runs past the data. */
export const QUALITY_SERIES_DAYS = 14;

const CHECK_VALUES: readonly string[] = Object.values(CHECKS);
const REVIEW_VALUES: readonly string[] = Object.values(REVIEW);

function oneOf(name: string, raw: string | undefined, values: readonly string[]): string | null {
  if (!raw) return null;
  if (!values.includes(raw)) throw new BadRequestException(`'${name}' must be one of ${values.join(", ")}`);
  return raw;
}

function bounded(name: string, raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.length > MAX_FILTER_CHARS)
    throw new BadRequestException(`'${name}' is at most ${MAX_FILTER_CHARS} characters`);
  return value;
}

export function parseRunFilters(q: RunFilterQuery): RunFilters {
  return {
    checks: oneOf("checks", q.checks, CHECK_VALUES) as Checks | null,
    review: oneOf("review", q.review, REVIEW_VALUES) as Review | null,
    prompt: bounded("prompt", q.prompt),
    model: bounded("model", q.model),
  };
}

/** `?service=` on the run list: absent, empty or `all` lists every service. */
export function parseOptionalService(raw: string | undefined): string | null {
  const value = raw?.trim();
  return !value || value === "all" ? null : value;
}

export function parseRequiredService(raw: string | undefined): string {
  const value = parseOptionalService(raw);
  if (value === null) throw new BadRequestException("'service' is required");
  return value;
}

/** `?step=` on the versions route: a node id, or absent for the whole pipeline. */
export function parseStep(raw: string | undefined): string | null {
  return bounded("step", raw);
}

export function parseOffset(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new BadRequestException("'offset' must be a whole number, 0 or more");
  return n;
}
