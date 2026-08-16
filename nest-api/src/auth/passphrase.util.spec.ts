import { describe, expect, it } from "vitest";
import { assertLength, hashPassphrase, MIN_PASSPHRASE, MIN_PASSWORD, verifyPassphrase } from "./passphrase.util";

const PASSPHRASE = "correct horse battery staple ok";

describe("verifyPassphrase", () => {
  it("accepts the passphrase it was given", async () => {
    expect(await verifyPassphrase(await hashPassphrase(PASSPHRASE), PASSPHRASE)).toBe(true);
  });

  it("rejects a different passphrase", async () => {
    expect(await verifyPassphrase(await hashPassphrase(PASSPHRASE), "incorrect horse battery staple")).toBe(false);
  });

  it("rejects an account with no passphrase, and still pays the derivation cost", async () => {
    const started = performance.now();
    expect(await verifyPassphrase(null, "anything at all, long enough")).toBe(false);

    // scrypt at these parameters takes ~300ms. An early `return false` on the null hash would
    // take approximately zero — making "this account has no passphrase" measurable with a
    // stopwatch, which is exactly the list of unrecoverable accounts an attacker would want.
    expect(performance.now() - started).toBeGreaterThan(50);
  });

  it("uses the same scheme as the password", async () => {
    // One KDF, one set of parameters, one place to raise the cost. The passphrase protects a
    // different thing; that is not a reason for it to be hashed differently.
    expect(await hashPassphrase(PASSPHRASE)).toMatch(/^scrypt\$131072\$8\$1\$/);
  });
});

describe("assertLength", () => {
  it("accepts a value at the boundary", () => {
    expect(() => assertLength("x".repeat(MIN_PASSWORD), MIN_PASSWORD, "password")).not.toThrow();
  });

  it("names the field and never repeats the value", () => {
    const secret = "short";
    try {
      assertLength(secret, MIN_PASSPHRASE, "recoveryPassphrase");
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("recoveryPassphrase");
      expect(message).toContain(String(MIN_PASSPHRASE));
      // A 400 quoting the rejected secret writes it into the access log of every proxy between
      // the browser and here.
      expect(message).not.toContain(secret);
    }
  });

  it("rejects undefined and empty as too short rather than passing them through", () => {
    expect(() => assertLength(undefined, MIN_PASSWORD, "password")).toThrow();
    expect(() => assertLength("", MIN_PASSWORD, "password")).toThrow();
  });
});
