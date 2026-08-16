/**
 * Loads `.env` before any test runs.
 *
 * The e2e suites get it for free — `ConfigModule.forRoot({ envFilePath })` reads the file while
 * the imports array is being evaluated, so it is done before a single provider is constructed.
 * A unit spec that instantiates one service in isolation never imports `AppModule` and so never
 * triggers that, which is how a test against a real Redis or MySQL silently falls back to a
 * default URL and passes for the wrong reason.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env: CI and ks-b both provide the environment directly.
}
