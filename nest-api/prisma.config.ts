import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration. The application never reads this — at runtime the connection is
 * built by `packages/db` from `DATABASE_URL` through the MariaDB driver adapter. This is only
 * how `prisma migrate` and `prisma db` find the schema and the database.
 */

// Node's own .env reader, so there is no dotenv dependency to keep current. On ks-b there is
// no .env beside the repository — `migrate deploy` is run by hand with the shared environment
// already exported — so a missing file is a normal state, not a failure.
try {
  process.loadEnvFile();
} catch {
  // Fall through to whatever is already in the environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
    // Development only. `migrate dev` replays the migration history into this scratch database
    // to work out what changed. Read from `process.env` rather than declared as `env(...)` in
    // the datasource block on purpose: undefined is then simply undefined, and `migrate deploy`
    // runs on ks-b without needing a shadow database to exist purely to satisfy a config check.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
