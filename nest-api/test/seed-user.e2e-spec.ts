import { spawn } from "node:child_process";
import { PrismaService } from "@db/prisma.service";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";

import type { INestApplication } from "@nestjs/common";

const EMAIL = "cli-owner@iknos.local";
const PASSWORD = "cli-password-1234";
const PASSPHRASE = "correct horse battery staple ok";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs `pnpm seed:user` the way ks-b does, over a pipe.
 *
 * Not a call into an exported function: the branch under test is the one that turns a Prisma
 * error code into a sentence, and it only exists on the path that also builds its own client and
 * reads its own configuration. Spawning is what proves the terminal sees the sentence.
 */
function seedUser(email: string, answers: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "scripts/create-account.ts", email], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));

    // Trailing newline included: `readLine` splits the drained stream, so the last answer needs
    // its terminator or it arrives glued to end-of-input.
    child.stdin.end(`${answers.join("\n")}\n`);
  });
}

describe("seed:user", () => {
  let app: INestApplication;

  const prisma = () => app.get(PrismaService);

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    // This suite owns `app_user` for the same reason the account suite does: `singleton` is
    // UNIQUE, so a leftover row is indistinguishable from the sealed instance under test.
    await prisma().appUser.deleteMany();
  });

  afterAll(async () => {
    await prisma().appUser.deleteMany();
    await app?.close();
  });

  it("creates the account on a blank instance", async () => {
    const result = await seedUser(EMAIL, [PASSWORD, PASSWORD, PASSPHRASE, PASSPHRASE]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Account created");

    const user = await prisma().appUser.findFirst();
    expect(user?.email).toBe(EMAIL);
    expect(user?.recoveryPassphraseHash).toBeTruthy();
  }, 60_000);

  it("explains itself on a sealed instance instead of throwing a Prisma error", async () => {
    await seedUser(EMAIL, [PASSWORD, PASSWORD, PASSPHRASE, PASSPHRASE]);

    const second = await seedUser("someone-else@iknos.local", [PASSWORD, PASSWORD, PASSPHRASE, PASSPHRASE]);

    expect(second.code).toBe(1);
    expect(second.stderr).toContain("This instance already has its account");
    // The point of the branch: a raw P2002 stack trace in a terminal is not an explanation, and
    // it is what this printed before IKN-21.
    expect(second.stderr).not.toContain("P2002");
    expect(second.stderr).not.toContain("PrismaClientKnownRequestError");

    // Still exactly one account, and still the first one.
    const users = await prisma().appUser.findMany();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe(EMAIL);
  }, 90_000);

  it("skips the passphrase on an empty answer, and says the account cannot be recovered", async () => {
    const result = await seedUser(EMAIL, [PASSWORD, PASSWORD, ""]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No passphrase set");

    const user = await prisma().appUser.findFirst();
    expect(user?.recoveryPassphraseHash).toBeNull();
  }, 60_000);

  it("refuses a password under the floor without naming it", async () => {
    const tooShort = "short";
    const result = await seedUser(EMAIL, [tooShort, tooShort]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("at least");
    // A terminal keeps scrollback and the shell keeps history; a rejection that quotes the
    // rejected password writes it into both.
    expect(result.stderr).not.toContain(tooShort);
    expect(await prisma().appUser.count()).toBe(0);
  }, 60_000);
});
