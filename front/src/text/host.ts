/**
 * The machine panel's copy (IKN-25) — the same split the chassis and the service view use.
 *
 * The level words exist because the badge's colour alone is unreadable to roughly one man in
 * twelve: the title and the screen-reader label say in words what the border says in amber.
 */
export const HOST_TEXT = {
  tag: "host",
  title: "Machine",
  open: "CPU, memory and disk",
  disk: "disk",
  memory: "memory",
  cpu: "cpu",
  load: "load",
  /* `htop`'s order and spelling for the three averages, so the line reads the way the terminal does. */
  loadAverages: (one: string, five: string, fifteen: string) => `${one} ${five} ${fifteen}`,
  cores: (n: number) => `${n} core${n === 1 ? "" : "s"}`,
  usedOf: (used: string, total: string) => `${used} / ${total}`,
  percent: (value: string) => `${value}%`,
  absent: "—",
  /* Under the disk chart: the alert rule's own lines, said out loud once so the dashes mean something. */
  diskLines: (warn: number, critical: number) => `alert at ${warn}% · critical at ${critical}%`,
  /* CPU and memory have no alert rule, so no colour — said once, so the grey reads as a decision. */
  unwatched: "no alert rule — not coloured",
  chartLabel: (name: string, range: string) => `${name} over the last ${range}`,
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  loading: "reading",
  failed: "Could not read the machine's history.",
  retry: "retry",
  /* The explicit empty state the ticket asks for. Says what is missing and where to look. */
  emptyRange: (range: string) =>
    `No host sample in the last ${range}. The collector writes one every 30s — if this persists, it is not running.`,
  noReading: "No sample in the last ten minutes — the host sampler is not writing.",
  sampledAt: (time: string) => `sampled ${time}`,
  everyThirty: "every 30s",
  /* The badge's title — the level in words, and the figure that caused it. */
  levelWord: {
    ok: "within limits",
    warning: "past the warning line",
    critical: "past the critical line",
    none: "no watched gauge readable",
    unknown: "no recent sample",
  },
  badgeHint: (host: string, word: string, detail: string) => `${host} · ${word}${detail} — open the machine panel`,
  badgeDisk: (pct: string) => ` · disk ${pct}%`,
} as const;
