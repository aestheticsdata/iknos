import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { RedisService } from "@redis/redis.service";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";
import { MIN_PASSPHRASE, MIN_PASSWORD, verifyPassphrase } from "./passphrase.util";
import { verifyPassword } from "./password.util";
import { Public } from "./public.decorator";
import { RateLimitService } from "./ratelimit.service";
import { UsersService } from "./users.service";

import type { Request } from "express";

class RegisterDto {
  @IsEmail({}, { message: "email must be an email address" })
  email!: string;

  @IsString()
  @MinLength(MIN_PASSWORD, { message: `password must be at least ${MIN_PASSWORD} characters` })
  password!: string;

  @IsString()
  @MinLength(MIN_PASSPHRASE, {
    message: `recoveryPassphrase must be at least ${MIN_PASSPHRASE} characters`,
  })
  recoveryPassphrase!: string;
}

class RecoverDto {
  @IsEmail({}, { message: "email must be an email address" })
  email!: string;

  @IsString()
  @MinLength(MIN_PASSPHRASE, {
    message: `recoveryPassphrase must be at least ${MIN_PASSPHRASE} characters`,
  })
  recoveryPassphrase!: string;

  @IsString()
  @MinLength(MIN_PASSWORD, { message: `password must be at least ${MIN_PASSWORD} characters` })
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(MIN_PASSWORD, { message: `password must be at least ${MIN_PASSWORD} characters` })
  password!: string;

  /** Optional: this route doubles as "set recovery passphrase" in the user menu. */
  @IsOptional()
  @IsString()
  @MinLength(MIN_PASSPHRASE, {
    message: `recoveryPassphrase must be at least ${MIN_PASSPHRASE} characters`,
  })
  recoveryPassphrase?: string;
}

/**
 * First-run registration, recovery, and password change.
 *
 * Zeus's shape, copied on purpose: an internal single-account console on the same box with the
 * same no-mail constraint, which already answered every question here.
 *
 * Registration is gated by whether the account exists, never by an environment variable. There
 * is no flag to set, none to forget, and no way to reopen it by editing a `.env` in a hurry.
 */
@Controller("api/auth")
export class AccountController {
  constructor(
    private readonly users: UsersService,
    private readonly rateLimit: RateLimitService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Lets the signup screen render its sealed state *before* anyone submits anything.
   *
   * This does leak "somebody has configured this instance". That is why it answers a boolean and
   * not an address: on a console that already answers `/login`, it is not a secret worth keeping.
   */
  @Public()
  @Get("bootstrap")
  async bootstrap() {
    return { sealed: await this.users.isSealed() };
  }

  @Public()
  @Post("register")
  async register(@Body() body: RegisterDto) {
    if (await this.users.isSealed()) throw new ConflictException("this instance already has its account");

    try {
      const user = await this.users.create(body.email, body.password, body.recoveryPassphrase);
      // No session. The front lands on /login with "account created — sign in": signing in
      // immediately proves the password works while the passphrase is still on screen to write
      // down.
      return { userId: user.id };
    } catch (error) {
      // The `count()` above is a race and only the UNIQUE constraint on `singleton` wins it —
      // including for two requests that arrive in the same millisecond.
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictException("this instance already has its account");
      }
      throw error;
    }
  }

  /**
   * Spends the recovery passphrase to set a new password.
   *
   * Three ways to fail, one answer: a wrong passphrase, an unknown address, and an account with
   * no passphrase on file are indistinguishable — in wording and, because the derivation always
   * runs, in timing.
   */
  @Public()
  @Post("recover")
  async recover(@Body() body: RecoverDto) {
    const email = UsersService.normaliseEmail(body.email);

    // Counted before the lookup, so a guesser pays the limit whether or not the address exists.
    if (!(await this.rateLimit.allowRecovery(email))) {
      // The one deliberate exception to the identical answers above: "try again in a quarter of
      // an hour" is useless advice if it looks like "wrong passphrase".
      throw new HttpException("Too many attempts", 429);
    }

    const user = await this.users.findByEmail(email);
    const matches = await verifyPassphrase(user?.recoveryPassphraseHash ?? null, body.recoveryPassphrase);
    if (!user || !matches) throw new UnauthorizedException("recovery failed");

    await this.users.setSecrets(user.id, body.password);

    // Whoever locked the owner out may be holding a live session, and a reset that leaves it
    // alive is cosmetic. No new session either — same reason as registration.
    await this.redis.clearSessionsForUser(user.id);
    await this.rateLimit.resetRecovery(email);

    return { ok: true };
  }

  /**
   * Authenticated, CSRF-protected by the global guard, and still requires the current password —
   * a session left open on an unlocked laptop must not be enough to take the account over.
   *
   * Doubles as "set recovery passphrase" for an account that has none.
   */
  @Post("password")
  async changePassword(@Body() body: ChangePasswordDto, @Req() req: Request) {
    const user = await this.users.findById(req.session.userId as number);
    const ok = user ? await verifyPassword(body.currentPassword, user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedException();

    await this.users.setSecrets(user.id, body.password, body.recoveryPassphrase);

    // The current session survives on purpose: changing a password should not log the owner out
    // of the tab they changed it in. Other sessions are not a concern — there is only ever one.
    return { ok: true };
  }
}
