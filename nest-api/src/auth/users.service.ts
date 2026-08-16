import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
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

  count(): Promise<number> {
    return this.prisma.appUser.count();
  }

  async create(email: string, password: string): Promise<AppUser> {
    return this.prisma.appUser.create({
      data: {
        email: UsersService.normaliseEmail(email),
        passwordHash: await hashPassword(password),
      },
    });
  }
}
