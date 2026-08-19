import { Injectable, Logger } from "@nestjs/common";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
// Relative, not aliased: an `@prisma/*` path alias would shadow the npm scope the Prisma
// packages themselves live in. Same reason trekker keeps this import relative.
import { PrismaClient } from "../../generated/prisma/client";

import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";

const CONNECT_TIMEOUT_MS = 10_000;
const CONNECTION_LIMIT = 10;

/**
 * Prisma over the MariaDB driver adapter, same pairing as PFA, Zeus and trekker.
 *
 * One instance for the process. The collector and the HTTP API share it (spec §3) — a second
 * client would be a second connection pool competing with the first for the same MySQL, and
 * the pool gauge the Service view draws would be measuring one of two without saying which.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      // Task 4's validated config rejects this at boot with a message naming the variable.
      // This guard is for the paths that start before Nest does.
      throw new Error("DATABASE_URL is not set");
    }

    const dsn = new URL(url);

    super({
      adapter: new PrismaMariaDb({
        host: dsn.hostname,
        port: dsn.port ? Number(dsn.port) : 3306,
        // Decoded: a password containing a reserved character is percent-encoded in the URL
        // and would otherwise be sent literally.
        user: decodeURIComponent(dsn.username),
        password: decodeURIComponent(dsn.password),
        database: dsn.pathname.replace(/^\//, ""),
        connectionLimit: CONNECTION_LIMIT,
        // Both timeouts bound the connect. Without them an address that accepts and then
        // stalls hangs module init, and the API never reaches listen() — it simply never
        // starts, with no error to read.
        connectTimeout: CONNECT_TIMEOUT_MS,
        acquireTimeout: CONNECT_TIMEOUT_MS,
        // Required against MySQL 8's default `caching_sha2_password`, and the same line
        // Zeus and Worldweathr carry. That plugin skips the RSA handshake only while the
        // account sits in the server's in-memory auth cache, and mysqld wipes that cache on
        // every restart — i.e. every reboot of ks-b. The next connection falls back to full
        // auth, which cannot send the password over a non-TLS socket without the server's
        // public key, and without this the driver refuses to fetch it. The symptom is not an
        // auth error: every query dies as `pool timeout ... (active=0 idle=0)` out of
        // `onApplicationBootstrap`, a connection failure wearing the costume of pool
        // exhaustion, and pm2 crashloops the API. Safe over loopback, where it trusts a key
        // served by a process on the same box; use TLS instead if this ever goes remote.
        allowPublicKeyRetrieval: true,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    PrismaService.logger.log("connected");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
