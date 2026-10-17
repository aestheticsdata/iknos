import { stripVTControlCharacters } from "node:util";

/**
 * One exception printed to stderr, put back into one line before it is parsed (IKN-75).
 *
 * An app that writes an error with `console.error` — Next's server among them — prints a header,
 * sometimes a line or two more of message (`Read more: https://…`), then the `    at …` frames.
 * Read line by line, that is five to fifteen ERROR rows for one throw, which is what buried the
 * stream under scanner probes. And the frames were lost twice over: `parser.ts` trims each line,
 * so the indentation `coalesce` recognises a frame by never reached it, and the Issues panel
 * grouped nothing at all.
 *
 * Folded here, on the raw lines, the frames keep their indentation inside one multi-line message:
 * one row in the stream, and a stack `errorFieldsOf` can read straight off the head.
 *
 * Folding works within one read chunk. A stack is written in one breath and read in one chunk;
 * one cut by a chunk boundary falls back to the old behaviour for its tail, nothing worse.
 */

/** `    at fn (/path:1:2)`, `    at /path:1:2`, `    ... 12 more`, `Caused by: …` — on the raw line. */
const FRAME = /^\s+(?:at\s+\S|\.{3}\s+\d+\s+more\s*$)|^\s*Caused by:\s/;

/** `Error: …`, `TypeError: …`, Next's `⨯ Error: …`. What may open a stack. */
const HEADER = /^(?:⨯\s*)?(?:[A-Za-z_$][\w$]*)?(?:Error|Exception)\b/;

/**
 * How many message lines a header may carry before its first frame. Next's error has one
 * (`Read more: …`); a header followed by more than this without a frame is not a stack, and its
 * lines are given back untouched.
 */
const MAX_MESSAGE_LINES = 4;

const isFrame = (line: string): boolean => FRAME.test(line);
const isHeader = (line: string): boolean => HEADER.test(stripVTControlCharacters(line).trim());

type Block = { lines: string[]; framed: boolean };

/** A block's lines as they go out: one joined line if a frame proved it a stack, else each alone. */
const release = (block: Block): string[] => (block.framed ? [block.lines.join("\n")] : block.lines);

/** A line that may extend a header still waiting for its first frame. */
const extendsMessage = (block: Block, line: string): boolean =>
  !block.framed &&
  block.lines.length <= MAX_MESSAGE_LINES &&
  line.trim() !== "" &&
  !line.trimStart().startsWith("{") &&
  !isHeader(line);

/**
 * Raw stderr lines → the same lines, each stack joined into its header with `\n`.
 *
 * A header's message lines are held, not committed: only the first frame proves they belonged to
 * a stack. A header that no frame follows hands every held line back as its own line, exactly as
 * before — folding must never glue together lines that were not one exception.
 */
export function foldStackLines(lines: string[]): string[] {
  const out: string[] = [];
  let open: Block | null = null;

  for (const line of lines) {
    if (open !== null && (isFrame(line) || extendsMessage(open, line))) {
      open.lines.push(line);
      open.framed ||= isFrame(line);
      continue;
    }

    if (open !== null) out.push(...release(open));
    // A frame with no open header is an orphan whose header was in the previous chunk: stored
    // alone, as it always was.
    open = isHeader(line) ? { lines: [line], framed: false } : null;
    if (open === null) out.push(line);
  }
  if (open !== null) out.push(...release(open));

  return out;
}
