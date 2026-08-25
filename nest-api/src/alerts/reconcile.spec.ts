import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";

import type { OpenAlert } from "./reconcile";
import type { Observation, Rule } from "./rule";

/**
 * The transition table of IKN-10 §2, exhaustively.
 *
 * These are the assertions that fail if someone "simplifies" a null check — which is the edit this
 * file exists to catch, because the resulting bug only shows up during a collector outage and
 * looks like the alerts resolving themselves.
 */

const instant: Rule = {
  key: "health_down",
  severity: "critical",
  title: "t",
  expr: "e",
  forMs: 0,
  threshold: 2,
  unit: "count",
  evaluate: async () => [],
};

const withFor: Rule = { ...instant, key: "error_rate", severity: "warning", forMs: 300_000 };

const T0 = Date.UTC(2026, 7, 25, 3, 0, 0);
const breach = (value = 9): Observation => ({ service: "svc", value, breached: true });
const clean = (value = 0): Observation => ({ service: "svc", value, breached: false });
const unknown = (): Observation => ({ service: "svc", value: null, breached: false });

const open = (over: Partial<OpenAlert> = {}): OpenAlert => ({
  id: 1,
  state: "firing",
  pendingSince: null,
  severity: "critical",
  ...over,
});

describe("reconcile", () => {
  describe("with no open alert", () => {
    it("fires at once for a rule with no for-window", () => {
      expect(reconcile(instant, breach(), null, T0)).toEqual({
        kind: "open",
        state: "firing",
        severity: "critical",
      });
    });

    it("opens pending for a rule that has one", () => {
      expect(reconcile(withFor, breach(), null, T0)).toEqual({
        kind: "open",
        state: "pending",
        severity: "warning",
      });
    });

    it("does nothing when the condition is false", () => {
      expect(reconcile(instant, clean(), null, T0)).toEqual({ kind: "none" });
    });

    it("does nothing when there is no reading", () => {
      expect(reconcile(instant, unknown(), null, T0)).toEqual({ kind: "none" });
    });
  });

  describe("with a pending alert", () => {
    const pending = open({ state: "pending", pendingSince: new Date(T0) });

    it("stays pending before the for-window has elapsed", () => {
      expect(reconcile(withFor, breach(), pending, T0 + 299_000).kind).toBe("touch");
    });

    it("promotes once it has", () => {
      expect(reconcile(withFor, breach(), pending, T0 + 300_000)).toEqual({
        kind: "promote",
        severity: "warning",
      });
    });

    it("resolves without ever firing when the condition lifts first", () => {
      // A condition true for one pass and gone the next never becomes an incident. This is the
      // whole point of `for`, and the alert still leaves a pending→resolved trail in the history.
      expect(reconcile(withFor, clean(), pending, T0 + 60_000)).toEqual({ kind: "resolve" });
    });

    it("promotes a row whose pendingSince is missing rather than leaving it stuck", () => {
      const orphan = open({ state: "pending", pendingSince: null });
      expect(reconcile(withFor, breach(), orphan, T0).kind).toBe("touch");
    });
  });

  describe("with a firing alert", () => {
    it("touches while the condition holds", () => {
      expect(reconcile(instant, breach(), open(), T0)).toEqual({ kind: "touch", severity: "critical" });
    });

    it("resolves when it lifts", () => {
      expect(reconcile(instant, clean(), open(), T0)).toEqual({ kind: "resolve" });
    });

    it("leaves it alone when there is no reading", () => {
      // The assertion this file exists for. A scrape outage answers `null` for every service at
      // once; reading that as "not breached" would close every alert on the box in one pass,
      // precisely when the box is least well.
      expect(reconcile(instant, unknown(), open(), T0)).toEqual({ kind: "none" });
    });

    it("resolves a measured zero, which is not the same as no reading", () => {
      expect(reconcile(instant, clean(0), open(), T0)).toEqual({ kind: "resolve" });
    });
  });

  describe("severity", () => {
    it("takes the observation's own when it has one", () => {
      // Only `disk_space` does this: 85 % is a warning and 95 % is not.
      const critical: Observation = { service: "ks-b", value: 96, breached: true, severity: "critical" };
      expect(reconcile(withFor, critical, null, T0)).toMatchObject({ severity: "critical" });
    });

    it("falls back to the rule's", () => {
      expect(reconcile(withFor, breach(), null, T0)).toMatchObject({ severity: "warning" });
    });

    it("can escalate an alert that is already open", () => {
      const worse: Observation = { service: "ks-b", value: 96, breached: true, severity: "critical" };
      expect(reconcile(withFor, worse, open({ severity: "warning" }), T0)).toEqual({
        kind: "touch",
        severity: "critical",
      });
    });
  });
});
