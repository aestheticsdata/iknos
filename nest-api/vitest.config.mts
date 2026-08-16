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
    setupFiles: ["reflect-metadata"],
    // `*spec.ts`, not `*.spec.ts`: the e2e files follow Nest's `*.e2e-spec.ts` convention, which
    // a dot-anchored glob silently skips — the run then reports success having executed nothing.
    include: ["src/**/*spec.ts", "test/**/*spec.ts"],
    // No tests until Task 4, and an empty run must not be a red build — otherwise the first
    // `pnpm test` teaches everyone to ignore its exit code.
    passWithNoTests: true,
  },
});
