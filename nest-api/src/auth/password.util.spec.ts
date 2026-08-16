import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.util";

const PASSWORD = "a-perfectly-ordinary-password";

describe("password hashing", () => {
  it("verifies a password against its own hash", async () => {
    expect(await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).toBe(true);
  });

  it("rejects a wrong password", async () => {
    expect(await verifyPassword("not-the-password", await hashPassword(PASSWORD))).toBe(false);
  });

  it("produces a different hash every time", async () => {
    // Random salt. Two identical passwords hashing to the same string would make the whole
    // table readable at a glance — and rainbow tables useful again.
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("records its parameters in the hash", async () => {
    const [scheme, n, r, p, salt, key] = (await hashPassword(PASSWORD)).split("$");

    expect(scheme).toBe("scrypt");
    expect([Number(n), Number(r), Number(p)]).toEqual([2 ** 17, 8, 1]);
    expect(Buffer.from(salt, "base64")).toHaveLength(16);
    expect(Buffer.from(key, "base64")).toHaveLength(32);
  });

  it("still verifies a hash made with weaker parameters", async () => {
    // The point of writing the parameters into the hash: raising the cost later must not lock
    // the one existing account out of its own instance.
    const legacy = await hashPassword(PASSWORD, { N: 2 ** 14, r: 8, p: 1 });

    expect(legacy).toContain(`$${2 ** 14}$`);
    expect(await verifyPassword(PASSWORD, legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
  });

  it("returns false for anything that is not one of our hashes, rather than throwing", async () => {
    // A column holding a bcrypt hash from another app, a truncated value, an empty string. Each
    // one is a failed login; none of them is a 500 that tells the caller the column is odd.
    for (const bad of ["", "not-a-hash", "scrypt$", "$2a$10$abcdefghijklmnopqrstuv", "scrypt$x$8$1$AA$BB"]) {
      expect(await verifyPassword(PASSWORD, bad)).toBe(false);
    }
  });
});
