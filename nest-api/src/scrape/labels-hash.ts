import { createHash } from "node:crypto";

/**
 * The indexable identity of a metric series (IKN-8): sixteen hex characters over the sorted
 * label set, stored in `metric_sample.labels_hash`.
 *
 * Canonical form is `JSON.stringify` of the sorted entry pairs — keys and values stay
 * structurally apart, so `{a:"x",b:""}` and `{a:"",b:"x"}` cannot collide the way naive
 * concatenation would. Changing this function is a data migration: every row already written
 * carries the old hashes.
 */
export function labelsHash(labels: Record<string, string> | null | undefined): string {
  const entries = labels ? Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16);
}
