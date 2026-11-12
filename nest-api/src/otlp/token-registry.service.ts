import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { hashToken, looksLikeToken, readOrigins } from "./token";

import type { OriginCheck, TokenGrant } from "./interfaces/otlp-types";

/**
 * How long the union of every active token's origins is reused for preflights. A new token's
 * origin is answered within this; a revoked one stops being *preflighted* within it — its POSTs
 * stop at once, because `resolve` reads the row on every request.
 */
const ORIGINS_TTL_MS = 30_000;

/** `last_used_at` is a hint for a human, not an audit log: one write a minute per token is plenty. */
const TOUCH_EVERY_MS = 60_000;

/**
 * The OTLP write tokens, read (IKN-87). Creating and revoking them is the CLI's job, never a route's.
 */
@Injectable()
export class TokenRegistry implements OriginCheck {
  private origins: { at: number; set: Set<string> } | null = null;
  private readonly touched = new Map<number, number>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * What a presented token grants, or `null` — unknown, revoked, or for a service that is no longer
   * in the registry or is disabled. All four answer the same 401: the caller learns nothing about
   * which tokens exist.
   *
   * By hash, so the comparison is an indexed equality on a value the caller cannot steer, and the
   * clear token never reaches a query or a log line.
   */
  async resolve(clear: string): Promise<TokenGrant | null> {
    if (!looksLikeToken(clear)) return null;

    const row = await this.prisma.ingestToken.findUnique({ where: { tokenHash: hashToken(clear) } });
    if (row === null || row.revokedAt !== null) return null;

    // Disabling a service has to stop its writes, exactly as it does on `POST /api/ingest`.
    const service = await this.prisma.service.findUnique({ where: { name: row.service }, select: { enabled: true } });
    if (service?.enabled !== true) return null;

    return { id: row.id, service: row.service, origins: readOrigins(row.allowedOrigins) };
  }

  /**
   * Whether `origin` belongs to any active token — the preflight's question (IKN-87 §CORS).
   *
   * A preflight carries no token (the browser strips custom headers from it), so it cannot be
   * answered per token. Answering for the union is safe because CORS was never the guard: the POST
   * that follows is checked against *its* token's own list and refused with a 403 otherwise.
   */
  async isKnownOrigin(origin: string): Promise<boolean> {
    const now = Date.now();
    if (this.origins === null || now - this.origins.at > ORIGINS_TTL_MS) {
      const rows = await this.prisma.ingestToken.findMany({
        where: { revokedAt: null },
        select: { allowedOrigins: true },
      });
      this.origins = { at: now, set: new Set(rows.flatMap((row) => readOrigins(row.allowedOrigins))) };
    }
    return this.origins.set.has(origin.toLowerCase());
  }

  /** Stamps `last_used_at`, at most once a minute per token, without making the request wait. */
  touch(id: number): void {
    const now = Date.now();
    if (now - (this.touched.get(id) ?? 0) < TOUCH_EVERY_MS) return;
    this.touched.set(id, now);

    this.prisma.ingestToken.update({ where: { id }, data: { lastUsedAt: new Date(now) } }).catch((error: unknown) => {
      // A missed stamp is cosmetic; the spans are already committed.
      logger.warn({ err: error }, "could not stamp ingest_token.last_used_at");
    });
  }
}
