import { normalizeOrigin } from "./token";

import type { CreateTokenArgs } from "./interfaces/otlp-types";

/**
 * The arguments of `pnpm token:create` (IKN-87), parsed without a dependency. Throws with a
 * sentence the CLI prints as is.
 *
 *   pnpm token:create opifex-front --origin https://opifex.1991computer.com [--origin …] [--label "…"]
 *
 * An origin that is not one — a trailing slash, a path, no scheme — is refused here rather than
 * stored: it would never equal a browser's `Origin` header, and the token would silently allow
 * nothing. Zero origins is allowed on purpose and means server-side senders only.
 */
export function parseCreateArgs(argv: string[]): CreateTokenArgs {
  let service: string | null = null;
  const origins: string[] = [];
  let label: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--origin" || arg === "--label") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;

      if (arg === "--label") {
        label = value.trim().slice(0, 128) || null;
        continue;
      }
      const origin = normalizeOrigin(value);
      if (origin === null) {
        throw new Error(
          `'${value}' is not an origin — write scheme and host only, e.g. https://opifex.1991computer.com`,
        );
      }
      if (!origins.includes(origin)) origins.push(origin);
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    if (service !== null) throw new Error(`one service per token — got '${service}' and '${arg}'`);
    service = arg;
  }

  if (service === null) throw new Error("which service? pnpm token:create <service> --origin https://…");
  return { service, origins, label };
}

/** `pnpm token:revoke <id>` — the id `token:list` prints. */
export function parseTokenId(argv: string[]): number {
  const id = Number(argv[0]);
  if (argv.length !== 1 || !Number.isInteger(id) || id < 1) throw new Error("usage: pnpm token:revoke <id>");
  return id;
}
