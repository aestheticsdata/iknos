import { describe, expect, it } from "vitest";
import { LineBuffer, MAX_LINE_BYTES } from "./line-buffer";

describe("LineBuffer", () => {
  it("yields complete lines only", () => {
    const b = new LineBuffer();
    b.push(Buffer.from("first\nsecond\npartial"));

    expect(b.nextLine()).toBe("first");
    expect(b.nextLine()).toBe("second");
    expect(b.nextLine()).toBeNull();
    expect(b.pendingBytes).toBe("partial".length);
  });

  it("reassembles a line split across reads", () => {
    const b = new LineBuffer();
    b.push(Buffer.from("hello "));
    expect(b.nextLine()).toBeNull();
    b.push(Buffer.from("world\n"));
    expect(b.nextLine()).toBe("hello world");
  });

  it("survives a read that splits a UTF-8 codepoint", () => {
    // "é" is 0xC3 0xA9. A read boundary between the two bytes is exactly what
    // chunk.toString() turns into U+FFFD, silently and undetectably.
    const b = new LineBuffer();
    b.push(Buffer.from([0x63, 0x61, 0x66, 0xc3]));
    expect(b.nextLine()).toBeNull();
    b.push(Buffer.from([0xa9, 0x0a]));
    expect(b.nextLine()).toBe("café");
  });

  it("strips a trailing carriage return", () => {
    const b = new LineBuffer();
    b.push(Buffer.from("windows\r\n"));
    expect(b.nextLine()).toBe("windows");
  });

  it("yields empty lines rather than swallowing them", () => {
    const b = new LineBuffer();
    b.push(Buffer.from("\n\na\n"));
    expect(b.nextLine()).toBe("");
    expect(b.nextLine()).toBe("");
    expect(b.nextLine()).toBe("a");
  });

  it("replaces genuinely invalid UTF-8 without failing", () => {
    const b = new LineBuffer();
    b.push(Buffer.from([0x61, 0xff, 0x62, 0x0a]));
    const line = b.nextLine();
    expect(line?.startsWith("a")).toBe(true);
    expect(line?.endsWith("b")).toBe(true);
  });

  it("drops the buffer if a single line grows absurd", () => {
    const b = new LineBuffer();
    b.push(Buffer.alloc(MAX_LINE_BYTES + 1, 0x78));
    expect(b.pendingBytes).toBe(0);
  });
});
