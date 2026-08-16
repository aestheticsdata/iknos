import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { hashPassphrase } from "./passphrase.util";
import { hashPassword } from "./password.util";

import type { AppUser } from "../../generated/prisma/client";

/**
 * The account. Singular — `app_user.singleton` is UNIQUE, so the database refuses a second one
 * rather than trusting anyone to remember there should not be one.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Addresses are normalised before they ever reach the database.
   *
   * Without this `Me@…` and `me@…` are two rows on a table that may only hold one, so the second
   * signup fails on the singleton constraint instead of on "that account already exists" — and
   * the owner is locked out by a capital letter.
   */
  static normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  findByEmail(email: string): Promise<AppUser | null> {
    return this.prisma.appUser.findUnique({ where: { email: UsersService.normaliseEmail(email) } });
  }

  findById(id: number): Promise<AppUser | null> {
    return this.prisma.appUser.findUnique({ where: { id } });
  }

  count(): Promise<number> {
    return this.prisma.appUser.count();
  }

  /** Whether the one account exists yet. This is the seal on registration. */
  async isSealed(): Promise<boolean> {
    return (await this.count()) > 0;
  }

  /**
   * The passphrase is optional here and required by `POST /api/auth/register`.
   *
   * The CLI is allowed to skip it — someone provisioning over SSH may not have decided on one
   * yet — and warns loudly that the account is then only recoverable in the database.
   */
  async create(email: string, password: string, passphrase?: string): Promise<AppUser> {
    // Both derivations at once. They are independent and each costs ~300ms; running them in
    // sequence would make registration feel broken.
    const [passwordHash, recoveryPassphraseHash] = await Promise.all([
      hashPassword(password),
      passphrase ? hashPassphrase(passphrase) : Promise.resolve(null),
    ]);

    return this.prisma.appUser.create({
      data: { email: UsersService.normaliseEmail(email), passwordHash, recoveryPassphraseHash },
    });
  }

  /**
   * Sets the password, and optionally the passphrase.
   *
   * `undefined` leaves the stored passphrase alone — changing a password must not silently throw
   * away the only way back into the account.
   */
  async setSecrets(id: number, password: string, passphrase?: string): Promise<void> {
    const [passwordHash, recoveryPassphraseHash] = await Promise.all([
      hashPassword(password),
      passphrase ? hashPassphrase(passphrase) : Promise.resolve(undefined),
    ]);

    await this.prisma.appUser.update({
      where: { id },
      data: { passwordHash, ...(recoveryPassphraseHash ? { recoveryPassphraseHash } : {}) },
    });
  }
}
