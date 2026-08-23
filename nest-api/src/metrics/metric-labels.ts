import { readJsonColumn } from "@common/json-column";

/**
 * One label out of a stored label set.
 *
 * `metric_sample.labels` is a MySQL `JSON` column, and the driver's two shapes for one are handled
 * in `@common/json-column` — where `log_entry.attrs` meets the same quirk. Both readers in this
 * module go through here so that the difference is answered once: discovering it in production is
 * a tile that files every status code under the tag `undefined`, and a pool bar that never finds
 * its `state`.
 */
export function readLabel(labels: unknown, key: string): string | null {
  const parsed = readJsonColumn(labels);
  if (parsed === null) return null;

  const value = parsed[key];
  return typeof value === "string" ? value : null;
}

/**
 * A label set that will not parse is a sample with no labels, never an exception.
 *
 * Re-exported under its old name rather than renamed at the call sites: it is the JSON primitive
 * with nothing metric-shaped about it, and the tests that name it are testing that behaviour.
 */
export { safeParseJson as safeParse } from "@common/json-column";
