import { describe, expect, it } from "vitest";
import { decide } from "./rotation";

const stored = { dev: 1n, inode: 100n, byteOffset: 500n };

describe("decide", () => {
  it("resumes when the file is unchanged and has grown", () => {
    expect(decide(stored, { dev: 1n, inode: 100n, len: 900n })).toEqual({
      kind: "read",
      from: 500n,
    });
  });

  it("does nothing when there is nothing new", () => {
    expect(decide(stored, { dev: 1n, inode: 100n, len: 500n })).toEqual({ kind: "idle" });
  });

  it("restarts from zero when the inode changed", () => {
    expect(decide(stored, { dev: 1n, inode: 101n, len: 20n })).toEqual({
      kind: "restart",
      from: 0n,
    });
  });

  it("restarts from zero when the device changed", () => {
    // Inode numbers repeat across filesystems often enough that dev must be part of the identity.
    expect(decide(stored, { dev: 2n, inode: 100n, len: 900n })).toEqual({
      kind: "restart",
      from: 0n,
    });
  });

  it("restarts from zero when the file was truncated", () => {
    expect(decide(stored, { dev: 1n, inode: 100n, len: 12n })).toEqual({
      kind: "restart",
      from: 0n,
    });
  });

  it("reads a brand new file from the start", () => {
    expect(decide(null, { dev: 1n, inode: 100n, len: 42n })).toEqual({
      kind: "restart",
      from: 0n,
    });
  });

  it("treats an empty new file as idle, not a read of nothing", () => {
    expect(decide(null, { dev: 1n, inode: 100n, len: 0n })).toEqual({ kind: "idle" });
  });
});
