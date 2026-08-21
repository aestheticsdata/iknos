import { describe, expect, it } from "vitest";
import { assertDayPartition, plan } from "./partitions";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * The date arithmetic, tested without a database.
 *
 * Everything the job does to MySQL is DDL that cannot be parameterised, so the only defence
 * against a wrong partition name is that the name was computed by code that is tested. That is
 * this file. `MaintenanceService` then executes the plan and does no arithmetic of its own.
 */
describe("plan", () => {
  it("creates the window ahead when none exists", () => {
    const p = plan([], d("2026-08-09"), 14, 3);
    expect(p.toCreate).toEqual(["p20260809", "p20260810", "p20260811"]);
    expect(p.toDrop).toEqual([]);
  });

  it("only creates what is missing", () => {
    const p = plan(["p20260809", "p20260810"], d("2026-08-09"), 14, 3);
    expect(p.toCreate).toEqual(["p20260811"]);
  });

  it("drops partitions past the retention window", () => {
    const existing = ["p20260725", "p20260726", "p20260727", "p20260809"];
    const p = plan(existing, d("2026-08-09"), 14, 3);
    expect(p.toDrop).toEqual(["p20260725", "p20260726"]);
  });

  it("never drops the future partition", () => {
    const p = plan(["p_future", "p20260101"], d("2026-08-09"), 14, 3);
    expect(p.toDrop).toEqual(["p20260101"]);
  });

  it("leaves unrecognised names alone", () => {
    const p = plan(["p_future", "something_else"], d("2026-08-09"), 14, 3);
    expect(p.toDrop).toEqual([]);
  });

  it("catches up after a long outage without creating the past", () => {
    const p = plan([], d("2026-09-09"), 14, 3);
    expect(p.toCreate).toEqual(["p20260909", "p20260910", "p20260911"]);
  });

  /**
   * The job runs at three in the morning, not at midnight, so `today` is never the midnight the
   * unit tests above pass in. Truncating it is what keeps the cutoff on a day boundary — without
   * that, "fourteen days" would mean "fourteen days and however many hours the job happens to
   * run at", and a partition would survive one extra pass before dropping.
   */
  it("reads the day from a mid-day clock, not the hour", () => {
    const noon = new Date("2026-08-09T11:30:00Z");
    const p = plan(["p20260726", "p20260809"], noon, 14, 3);
    expect(p.toCreate).toEqual(["p20260810", "p20260811"]);
    expect(p.toDrop).toEqual(["p20260726"]);
  });

  /**
   * A partition holding data still inside the window is not dropped, whatever the hour.
   * `p20260727` is thirteen days old on 2026-08-09 and must survive.
   */
  it("keeps the last day inside the window", () => {
    const p = plan(["p20260726", "p20260727"], new Date("2026-08-09T23:59:59Z"), 14, 3);
    expect(p.toDrop).toEqual(["p20260726"]);
  });

  /** Ordered oldest first, so a partial failure stops with the newest data still present. */
  it("drops oldest first", () => {
    const p = plan(["p20260727", "p20260725", "p20260726"], d("2026-08-10"), 14, 3);
    expect(p.toDrop).toEqual(["p20260725", "p20260726", "p20260727"]);
  });
});

/**
 * The names in these statements are interpolated into DDL, because DDL cannot be parameterised.
 * What makes that acceptable is that a name is always either generated from a `Date` or read back
 * from `information_schema` and matched against `/^p\d{8}$/` — never from anything a user typed.
 *
 * That is an invariant, not a convention, so it is enforced here rather than described in a
 * comment somebody will refactor past.
 */
describe("assertDayPartition", () => {
  it("accepts a generated day name", () => {
    expect(() => assertDayPartition("p20260821")).not.toThrow();
  });

  it("refuses anything that is not one", () => {
    expect(() => assertDayPartition("p_future")).toThrow(/not a day partition/);
    expect(() => assertDayPartition("log_entry; DROP TABLE log_entry")).toThrow(/not a day partition/);
    expect(() => assertDayPartition("p2026082")).toThrow(/not a day partition/);
  });
});
