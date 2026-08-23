/**
 * One label out of a stored label set.
 *
 * `metric_sample.labels` is a MySQL `JSON` column, and it arrives from `$queryRaw` as either a
 * parsed object or the text it was stored as, depending on how the driver treats a given column
 * expression — while the same column read through Prisma's own model API is always parsed. Both
 * readers in this module go through here so that the difference is handled once: discovering it in
 * production is a tile that files every status code under the tag `undefined`, and a pool bar that
 * never finds its `state`.
 */
export function readLabel(labels: unknown, key: string): string | null {
  const parsed = typeof labels === "string" ? safeParse(labels) : labels;
  if (typeof parsed !== "object" || parsed === null) return null;

  const value = (parsed as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/** A label set that will not parse is a sample with no labels, never an exception. */
export function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
