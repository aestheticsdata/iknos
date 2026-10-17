import { describe, expect, it } from "vitest";
import { foldStackLines } from "./stack-fold";

// What Next prints for a forged Server Action, as it lands in `-error.log`.
const nextError = [
  'Error: The Server Reference ID did not match the expected format. Received "x".',
  "Read more: https://nextjs.org/docs/messages/failed-to-find-server-action",
  "    at Object.get (.next/server/chunks/ssr/a.js:1:2)",
  "    at async n (.next/server/chunks/ssr/b.js:2:3)",
  "    at async p (.next/server/chunks/ssr/b.js:2:4598)",
];

describe("foldStackLines", () => {
  it("folds a header, its message line and its frames into one line", () => {
    expect(foldStackLines(nextError)).toEqual([nextError.join("\n")]);
  });

  it("keeps the frames' indentation inside the folded line", () => {
    const [folded] = foldStackLines(nextError);
    expect(folded.split("\n")[2]).toBe("    at Object.get (.next/server/chunks/ssr/a.js:1:2)");
  });

  it("separates two stacks printed back to back", () => {
    const second = ["TypeError: boom", "    at f (/srv/app.js:1:1)"];
    expect(foldStackLines([...nextError, ...second])).toEqual([nextError.join("\n"), second.join("\n")]);
  });

  it("ends a stack at the first line that is neither a frame nor a message line", () => {
    const after = '{"level":30,"msg":"next request"}';
    expect(foldStackLines([...nextError, after])).toEqual([nextError.join("\n"), after]);
  });

  it("gives back a header that no frame follows, line by line", () => {
    const lines = ["Error: no stack here", "plain line", "another"];
    expect(foldStackLines(lines)).toEqual(lines);
  });

  it("does not let a header without frames swallow a long run of lines", () => {
    const lines = ["Error: x", "a", "b", "c", "d", "e", "    at f (/srv/app.js:1:1)"];
    // The header gave up after its message budget, so the frame is an orphan.
    expect(foldStackLines(lines)).toEqual(lines);
  });

  it("never folds into a JSON line", () => {
    const lines = ["Error: x", '{"level":50,"msg":"structured"}', "    at f (/srv/app.js:1:1)"];
    expect(foldStackLines(lines)).toEqual(lines);
  });

  it("stores an orphan frame alone, as before", () => {
    const lines = ["    at async p (.next/b.js:2:4598)", "plain line"];
    expect(foldStackLines(lines)).toEqual(lines);
  });

  it("recognises Next's ⨯ prefix and a nested cause", () => {
    const lines = ["⨯ Error: outer", "    at f (/srv/a.js:1:1)", "Caused by: Error: inner", "    at g (/srv/b.js:2:2)"];
    expect(foldStackLines(lines)).toEqual([lines.join("\n")]);
  });
});
