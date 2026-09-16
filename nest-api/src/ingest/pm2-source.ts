import { glob } from "node:fs/promises";
import path from "node:path";
import { parse as parseEcs } from "./parser";

import type { LogRecord } from "./log-record";
import type { Source, SourceFile } from "./source";

/**
 * PM2 names its files `<app>-out-<pm_id>.log` and `<app>-error-<pm_id>.log`.
 *
 * **The trailing process id is the part that matters here.** Without stripping it, `pfa-nest-api`
 * arrives as `pfa-nest-api-out-39` — a service name nobody recognises, a rail full of duplicates,
 * and stdout and stderr recorded as two unrelated applications. Worse, the stream is then read as
 * `out` for an error file, so a line that carried no explicit level is stored as info.
 *
 * That id also changes: PM2 hands out a new one on every restart, so the same application has
 * `…-out-45.log` and `…-out-5.log` side by side. Both must resolve to one service.
 *
 * A few apps configure `out_file` explicitly and get a plain `<name>.log` with no suffix at all.
 * Those fall through to the last line, which is the right answer for them.
 */
export function serviceAndStream(file: string): { service: string; stream: "out" | "err" } {
  const stem = path.basename(file, path.extname(file));
  // Only the id, and only at the end. An application legitimately called `foo-2` keeps its name:
  // its file is `foo-2-out-14.log`, and what is removed is `-14`.
  const named = stem.replace(/-\d+$/, "");

  if (named.endsWith("-error")) return { service: named.slice(0, -"-error".length), stream: "err" };
  if (named.endsWith("-out")) return { service: named.slice(0, -"-out".length), stream: "out" };
  return { service: stem, stream: "out" };
}

/**
 * Everything with a stdout, which is every backend and every server-rendered page on ks-b.
 *
 * This is the collector as it has always worked, named. The service comes from the filename
 * because that is where PM2 puts it, and `log_entry.service` has therefore always carried the PM2
 * name — which is why the registry's `name` column holds PM2 names and not friendlier labels.
 */
export class Pm2Source implements Source {
  readonly name = "pm2";

  constructor(private readonly pattern: string) {}

  /**
   * Materialised rather than streamed, which is the one difference from the loop this replaces.
   * `poll()` used `for await` straight off the glob; at the fleet's ~40 files, collecting them
   * first costs nothing and lets both sources answer with one type.
   */
  async files(): Promise<SourceFile[]> {
    const out: SourceFile[] = [];
    for await (const file of glob(this.pattern)) {
      out.push({ file, ...serviceAndStream(file) });
    }
    return out;
  }

  parse(line: string, service: string, stream: "out" | "err"): LogRecord | null {
    return parseEcs(line, service, stream);
  }
}
