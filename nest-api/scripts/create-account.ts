import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../src/auth/password.util";

/**
 * Creates **the** account. Not **an** account.
 *
 * `app_user.singleton` is UNIQUE, so a second run fails in the database rather than on a check
 * anyone could forget. That is also why there is no `POST /users`: the only way in is standing
 * at the machine, and until IKN-21 adds first-run registration it is the only way at all.
 *
 * Usage: `pnpm seed:user you@example.com`
 */

process.loadEnvFile();

const MIN_PASSWORD = 12;

/**
 * Reads without echoing.
 *
 * The prompt is written directly and the readline output muted afterwards — muting from the
 * start would swallow the question too, and a terminal that asks nothing while waiting for a
 * password looks like a hang.
 */
function promptHidden(label: string): Promise<string> {
  // Piped input — a provisioning script, or `printf 'pw\npw\n' | pnpm seed:user …` on ks-b.
  // readline in terminal mode garbles a pipe, and there is nothing to hide from a stream that
  // was never echoed in the first place.
  if (!stdin.isTTY) return readLine();

  return new Promise((resolve) => {
    stdout.write(label);
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    (rl as unknown as { _writeToOutput: (chunk: string) => void })._writeToOutput = () => {};

    rl.question("", (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });
}

let piped: string[] | null = null;

/**
 * One line off a piped stdin. The password never appears in argv either way.
 *
 * The whole stream is drained once and then handed out line by line. Opening a second reader
 * for the confirmation would find stdin already consumed by the first — the promise never
 * settles, the event loop empties, and the process exits 0 having printed nothing at all.
 */
async function readLine(): Promise<string> {
  if (piped === null) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    piped = Buffer.concat(chunks).toString("utf8").split("\n");
  }
  return piped.shift() ?? "";
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail("Usage: pnpm seed:user you@example.com");
  }

  const password = await promptHidden("  Password: ");
  if (password.length < MIN_PASSWORD) {
    // Names the rule, never repeats the value — this runs in a terminal whose scrollback and
    // shell history outlive the session.
    fail(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
  if ((await promptHidden("  Confirm:  ")) !== password) {
    fail("The two entries did not match.");
  }

  const dsn = new URL(process.env.DATABASE_URL ?? "");
  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: dsn.hostname,
      port: dsn.port ? Number(dsn.port) : 3306,
      user: decodeURIComponent(dsn.username),
      password: decodeURIComponent(dsn.password),
      database: dsn.pathname.replace(/^\//, ""),
    }),
  });

  try {
    const user = await prisma.appUser.create({
      data: { email, passwordHash: await hashPassword(password) },
    });
    console.log(`\n  Account created: ${user.email} (id ${user.id})\n`);
  } catch (error) {
    // P2002 is the unique violation, on `singleton` or on `email`. Either way this instance
    // already has its account, and a raw Prisma stack trace is a poor way to say so.
    if ((error as { code?: string }).code === "P2002") {
      fail("This instance already has its account. Use recovery, or reset it in the database.");
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: Error) => {
  console.error(`\n  ${error.message}\n`);
  process.exit(1);
});
