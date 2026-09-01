import { spawnSync } from "node:child_process";
import { loadDatabaseUrl, looksLikeProduction, openPrisma } from "./env";

/**
 * What `pnpm dev` runs first, so that developing means one command (IKN-64): the mock fleet is
 * running, and the database holds the corpus. Idempotent and quiet — a fleet already up is left
 * alone (restarting it would reset every counter and uptime), a database already populated is
 * left alone (`pnpm mock` resets, and a reset is something a person asks for). Nothing here can
 * block the API from starting: every failure is a printed sentence, never an exit code.
 *
 * Never on ks-b: `pnpm dev` is a laptop verb, and the guards in `env.ts` refuse production
 * anyway.
 */

const step = (label: string): void => console.log(`dev-up: ${label}`);

const discovered = loadDatabaseUrl();
if (looksLikeProduction(discovered)) {
  step("production detected — nothing to do here");
  process.exit(0);
}

/* The fleet: start it unless it already runs. `status` costs one pm2 round-trip. */
const status = spawnSync("pnpm", ["exec", "tsx", "mock/fleet.ts", "status"], { encoding: "utf8" });
if (status.status !== 0) {
  step("pm2 is missing — the fleet stays off, the API starts anyway (`npm i -g pm2` to fix)");
} else if (status.stdout.includes("online")) {
  step("fleet already running");
} else {
  const started = spawnSync("pnpm", ["exec", "tsx", "mock/fleet.ts", "start"], { encoding: "utf8" });
  if (started.status === 0) step("fleet started");
  else step(`fleet did not start — ${started.stderr.trim().split("\n").slice(-3).join(" · ")}`);
}

/* The corpus: load it once, when the database is empty. */
const prisma = openPrisma(new URL(discovered.url));
prisma.logEntry
  .count()
  .then((rows) => {
    if (rows > 0) {
      step(`corpus present (${rows} log lines) — run \`pnpm mock\` yourself to re-anchor it`);
      return;
    }
    step("database is empty — loading the corpus");
    const loaded = spawnSync("pnpm", ["mock"], { stdio: "inherit" });
    step(loaded.status === 0 ? "corpus loaded" : "corpus did not load — see above; the API starts anyway");
  })
  .catch((error: unknown) => step(`database not reachable (${String(error).slice(0, 80)}) — the API will say why`))
  .finally(() => prisma.$disconnect());
