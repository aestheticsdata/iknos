/**
 * The rotation decision, pulled out as a pure function so every case is testable without a
 * filesystem. The I/O around it (the tailer) stays thin.
 *
 * All values are bigint because they come from `stat(file, { bigint: true })` — inode numbers do
 * not fit safely in a double on every filesystem, and a truncated inode is a misidentified file.
 */

export type StoredOffset = { dev: bigint; inode: bigint; byteOffset: bigint };
export type FileStat = { dev: bigint; inode: bigint; len: bigint };

export type Action = { kind: "idle" } | { kind: "read"; from: bigint } | { kind: "restart"; from: bigint };

export function decide(stored: StoredOffset | null, now: FileStat): Action {
  if (stored === null) {
    return now.len === 0n ? { kind: "idle" } : { kind: "restart", from: 0n };
  }

  // A different inode or device means the path now names a different file — the rotation moved
  // ours away and put a fresh one here. A length below our offset means someone truncated it in
  // place (`pm2 flush`). Either way the stored position describes a file that no longer exists.
  const replaced = stored.dev !== now.dev || stored.inode !== now.inode;
  const truncated = now.len < stored.byteOffset;

  if (replaced || truncated) {
    return now.len === 0n ? { kind: "idle" } : { kind: "restart", from: 0n };
  }
  if (now.len > stored.byteOffset) return { kind: "read", from: stored.byteOffset };
  return { kind: "idle" };
}
