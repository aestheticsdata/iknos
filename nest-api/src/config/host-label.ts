import { parseEnv } from "./env.validation";

import type { Provider } from "@nestjs/common";

/** The injection token for the host's label (IKN-65) — a string, so it needs a name of its own. */
export const HOST_LABEL = "HOST_LABEL";

/**
 * The host label as an injectable, for the two places that speak about the machine as a whole: the
 * badge's poll and the disk rule's alert. Built from `parseEnv` like every other setting, so the
 * `os.hostname()` fallback is decided once, in `env.validation.ts`.
 */
export const hostLabelProvider: Provider = {
  provide: HOST_LABEL,
  useFactory: () => parseEnv({ ...process.env }).hostLabel,
};
