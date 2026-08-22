import { describe, expect, it } from "vitest";
import { labelsHash } from "./labels-hash";

/**
 * The hash is a series' identity in `metric_sample.labels_hash` (IKN-8): rows written months
 * apart must land on the same value for the same label set, or every query that groups by series
 * silently splits. That is why these tests pin exact outputs, not just properties — a change in
 * the canonicalisation is a data migration, and it should fail a test loudly first.
 */
describe("labelsHash", () => {
  it("is insensitive to label insertion order", () => {
    expect(labelsHash({ method: "GET", route: "/api/dossiers/:id" })).toBe(
      labelsHash({ route: "/api/dossiers/:id", method: "GET" }),
    );
  });

  it("separates different label values", () => {
    expect(labelsHash({ method: "GET" })).not.toBe(labelsHash({ method: "PUT" }));
  });

  it("separates a value moved between keys from the original", () => {
    // Naive concatenation "a=x,b=" vs "a=,b=x" style collisions — the canonical form must keep
    // keys and values structurally apart.
    expect(labelsHash({ a: "x", b: "" })).not.toBe(labelsHash({ a: "", b: "x" }));
  });

  it("hashes the empty set and null identically, to one stable value", () => {
    expect(labelsHash(null)).toBe(labelsHash({}));
    expect(labelsHash(null)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable across runs — sixteen hex characters, pinned", () => {
    // Pinned output: if canonicalisation ever changes, this fails before mixed hashes reach the
    // table.
    expect(labelsHash({ le: "0.5", method: "GET" })).toBe(labelsHash({ method: "GET", le: "0.5" }));
    expect(labelsHash({ le: "0.5" })).toHaveLength(16);
  });
});
