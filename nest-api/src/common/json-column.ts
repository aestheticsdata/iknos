/**
 * Reading a MySQL `JSON` column back out of `$queryRaw`.
 *
 * The same column arrives as a parsed object or as the text it was stored as, depending on how the
 * driver treats a given column expression — while the same column read through Prisma's own model
 * API is always parsed. Both readers that touch a JSON column go through here so the difference is
 * handled in one place: discovering it in production is a panel that files every key under
 * `undefined`, which looks like missing data rather than like a driver quirk.
 */

/** Text that will not parse is an absence, never an exception. */
export function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * A JSON column as an object, whichever of the two shapes the driver handed back.
 *
 * An array parses but is not an object of keys, and every caller here wants keys — so it answers
 * `null` rather than something a lookup would silently return `undefined` from.
 */
export function readJsonColumn(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === "string" ? safeParseJson(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
