import { issueToken, readOrigins } from "@otlp/token";
import { parseCreateArgs, parseTokenId } from "@otlp/token-args";
import { loadDatabaseUrl, openPrisma } from "../mock/env";

import type { PrismaClient } from "@generated/prisma/client";

/**
 * The OTLP write tokens, managed over SSH (IKN-87). There is deliberately no route for this: a
 * token is created by someone with a shell on the box, never by anything reachable from a browser.
 *
 *   pnpm token:create <service> --origin https://<app>.1991computer.com [--origin …] [--label "…"]
 *   pnpm token:list
 *   pnpm token:revoke <id>
 *
 * `create` prints the clear token **once**. Only its SHA-256 is stored, so a lost token is replaced,
 * never recovered: create a new one, deploy it, revoke the old.
 *
 * The database is found the way `seed:user` finds it — the environment, `.env`, then the pm2
 * ecosystem beside the release on ks-b.
 */

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

async function create(prisma: PrismaClient, argv: string[]): Promise<void> {
  const args = parseCreateArgs(argv);

  const service = await prisma.service.findUnique({ where: { name: args.service } });
  if (service === null) {
    const known = await prisma.service.findMany({ select: { name: true }, orderBy: { name: "asc" } });
    fail(`no service '${args.service}' in the registry. Known: ${known.map((s) => s.name).join(", ")}`);
  }

  const { clear, hash } = issueToken();
  const row = await prisma.ingestToken.create({
    data: {
      service: args.service,
      tokenHash: hash,
      label: args.label ?? `${args.service} ${new Date().toISOString().slice(0, 10)}`,
      allowedOrigins: args.origins,
    },
  });

  console.log(`token #${row.id} for ${row.service} — ${row.label}`);
  console.log(`origins: ${args.origins.length > 0 ? args.origins.join(", ") : "(none: server-side senders only)"}`);
  console.log("");
  console.log(clear);
  console.log("");
  console.log("Shown once and not stored: put it in the app's build environment now.");
  console.log("It writes spans for this one service and grants nothing else.");
}

async function list(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.ingestToken.findMany({ orderBy: { id: "asc" } });
  if (rows.length === 0) {
    console.log("no tokens");
    return;
  }

  for (const row of rows) {
    const state = row.revokedAt ? `revoked ${row.revokedAt.toISOString()}` : "active";
    const used = row.lastUsedAt ? row.lastUsedAt.toISOString() : "never";
    console.log(
      `#${row.id}  ${row.service}  ${state}  last used ${used}  "${row.label}"  ${readOrigins(row.allowedOrigins).join(" ")}`,
    );
  }
}

async function revoke(prisma: PrismaClient, argv: string[]): Promise<void> {
  const id = parseTokenId(argv);
  const row = await prisma.ingestToken.findUnique({ where: { id } });
  if (row === null) fail(`no token #${id}`);
  if (row?.revokedAt) fail(`token #${id} was already revoked on ${row.revokedAt.toISOString()}`);

  await prisma.ingestToken.update({ where: { id }, data: { revokedAt: new Date() } });
  // Its POSTs stop now; preflights from its origins can still be answered for up to 30 s
  // (`TokenRegistry`), which lets nothing through.
  console.log(`token #${id} (${row?.service}) revoked`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const prisma = openPrisma(new URL(loadDatabaseUrl().url));

  try {
    if (command === "create") await create(prisma, rest);
    else if (command === "list") await list(prisma);
    else if (command === "revoke") await revoke(prisma, rest);
    else fail("usage: ingest-token create|list|revoke …");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
