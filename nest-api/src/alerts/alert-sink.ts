import type { Severity } from "./rule";

/**
 * The one way out of the engine (IKN-10 §5).
 *
 * v1 pushes nothing anywhere — you come and look, and IKN-15's hint line says so in as many words.
 * But "a rule just started firing" is the moment a Telegram or e-mail channel would want, and
 * having that moment already isolated is the difference between adding a channel and rewriting the
 * engine to find out where the moment was.
 *
 * An interface and a no-op is the whole cost of not having to do that later.
 */

export type FiredAlert = {
  id: number;
  ruleKey: string;
  service: string;
  severity: Severity;
  title: string;
  expr: string;
  value: number | null;
  threshold: number | null;
  unit: string | null;
};

export interface AlertSink {
  onFiring(alert: FiredAlert): Promise<void>;
}

/**
 * Ships as the only implementation.
 *
 * Awaited inside the engine's per-rule `try`, so a sink that throws costs its rule and nothing
 * else — the same isolation every rule already has, extended to the thing most likely to be
 * talking to a network.
 */
export class NoopSink implements AlertSink {
  async onFiring(): Promise<void> {}
}
