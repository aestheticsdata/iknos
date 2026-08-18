import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Nest resolves injected dependencies from `design:paramtypes`, which only exists when the
  // transform emits decorator metadata. Vitest's default esbuild transform does not, so every
  // constructor injection would resolve to `undefined` — and the failure reads as a broken
  // provider, not a missing compiler flag. SWC emits it.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    globals: false,
    environment: "node",
    // class-validator and class-transformer read their decorators back through the metadata
    // reflection API. Nest's own bootstrap imports this; unit tests never reach bootstrap, so
    // without it every validator silently sees an empty rule set and validation always passes.
    setupFiles: ["reflect-metadata", "./test/setup-env.ts"],
    // `*spec.ts`, not `*.spec.ts`: the e2e files follow Nest's `*.e2e-spec.ts` convention, which
    // a dot-anchored glob silently skips — the run then reports success having executed nothing.
    include: ["src/**/*spec.ts", "test/**/*spec.ts"],
    // No tests until Task 4, and an empty run must not be a red build — otherwise the first
    // `pnpm test` teaches everyone to ignore its exit code.
    passWithNoTests: true,
    // One file at a time, against one MySQL and one Redis.
    //
    // `app_user.singleton` is UNIQUE: two suites cannot hold an account each, so a parallel run
    // has them deleting each other's rows and failing with 401s and 409s that look like real
    // bugs. The rate-limit counters live in a shared keyspace and collide the same way.
    //
    // The honest fix would be a database per worker; that is not worth its weight for a suite
    // this size. This costs about twenty seconds and removes a whole class of phantom failure.
    fileParallelism: false,
    // `--expose-gc` is supplied by the `test` script in package.json, not here: vitest 4 ignores
    // `poolOptions.forks.execArgv`. The sustained-load test needs it to measure retained memory —
    // without a forced collection `heapUsed` is dominated by garbage V8 has not swept, and reads
    // as a 66 MB leak when nothing is retained. That test asserts the flag is present rather than
    // silently measuring nothing, so this staying broken cannot pass unnoticed.
  },
});
