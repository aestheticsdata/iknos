/**
 * Splits a byte stream into lines, safely across read boundaries.
 *
 * The smallest piece of the collector and the one most worth getting exactly right. Reads arrive
 * as Buffers cut wherever the kernel felt like cutting them, and **bytes stay bytes until a whole
 * line exists**: decoding a partial read turns a split multi-byte codepoint into U+FFFD with no
 * error and no way to notice — the classic, silent corruption of this kind of tool, invisible
 * until the day a search for an accented word returns nothing.
 */

/**
 * A single log line longer than this is garbage, not something to buffer. Real ECS lines are a
 * few kilobytes at most; the cap exists for a file with no newlines at all, which would otherwise
 * grow the heap until the process dies.
 */
export const MAX_LINE_BYTES = 1024 * 1024;

const LF = 0x0a;
const CR = 0x0d;

export class LineBuffer {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buf, chunk]);

    if (this.buf.length > MAX_LINE_BYTES && !this.buf.includes(LF)) {
      this.buf = Buffer.alloc(0);
    }
  }

  /**
   * Returns the next complete line, or null if no newline has arrived yet.
   */
  nextLine(): string | null {
    const idx = this.buf.indexOf(LF);
    if (idx === -1) return null;

    let end = idx;
    if (end > 0 && this.buf[end - 1] === CR) end--;

    const line = this.buf.subarray(0, end).toString("utf8");
    // A view, not a copy. The next push() concatenates into a fresh allocation, so the original
    // chunk is released then; nothing accumulates.
    this.buf = this.buf.subarray(idx + 1);
    return line;
  }

  get pendingBytes(): number {
    return this.buf.length;
  }
}
