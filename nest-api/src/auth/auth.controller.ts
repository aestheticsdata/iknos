import { randomBytes } from "node:crypto";
import { Body, Controller, Get, HttpException, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { RedisService } from "@redis/redis.service";
import { IsEmail, IsString, MinLength } from "class-validator";
import { verifyPassword } from "./password.util";
import { Public } from "./public.decorator";
import { RateLimitService } from "./ratelimit.service";
import { SESSION_COOKIE_NAME } from "./session.constants";
import { UsersService } from "./users.service";

import type { Request, Response } from "express";

const CSRF_TOKEN_BYTES = 32;

/**
 * A real hash of a password nobody has, generated once with `hashPassword`.
 *
 * A constant rather than a value computed at boot: the derivation costs ~300ms, and paying that
 * on every start for a string that never changes is a strange way to spend a deploy.
 */
const DUMMY_HASH = "scrypt$131072$8$1$5xHxEbajAFud2R61qsBaPQ==$5fsBiDt3TJMA5j6eLqN4EUlWUNtcIl1JGg9rm2v3umk=";

class LoginDto {
  @IsEmail({}, { message: "email must be an email address" })
  email!: string;

  /**
   * One character, not twelve. Length policy belongs to registration; enforcing it here would
   * reject a valid older password and, worse, answer 400 instead of 401 — telling an attacker
   * their guess was the wrong *shape* rather than simply wrong.
   */
  @IsString()
  @MinLength(1, { message: "password must not be empty" })
  password!: string;
}

@Controller("api")
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly rateLimit: RateLimitService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Post("auth/login")
  async login(@Body() body: LoginDto, @Req() req: Request) {
    // `req.ip` is the real client only because main.ts trusts the proxy. Without that every
    // request looks like 127.0.0.1 and the fifth failed attempt locks out the whole internet.
    const ip = req.ip ?? "unknown";
    if (!(await this.rateLimit.allow(ip))) {
      // Deliberately distinguishable from a failed login: "try again in a minute" is useless
      // advice if it is indistinguishable from "wrong password".
      throw new HttpException("Too many attempts", 429);
    }

    const user = await this.users.findByEmail(body.email);
    // The derivation runs whether or not the account exists, so a missing account and a wrong
    // password cost the same ~300ms. `&& false` rather than skipping it: the work has to happen,
    // its result simply must not be able to grant anything.
    const ok = user
      ? await verifyPassword(body.password, user.passwordHash)
      : (await verifyPassword(body.password, DUMMY_HASH)) && false;

    if (!user || !ok) throw new UnauthorizedException();

    // One live session per account: the previous cookie stops working the moment this one is
    // issued. Cleared before the new session is written, so it cannot sweep away its own.
    await this.redis.clearSessionsForUser(user.id);

    // A fresh session id, and this is not decoration. Without it, anyone who can plant a cookie
    // in the victim's browser keeps a working handle on the session once the victim logs in.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });

    req.session.userId = user.id;
    req.session.csrfToken = randomBytes(CSRF_TOKEN_BYTES).toString("base64url");

    await this.rateLimit.reset(ip);

    // The middleware writes the record and sets the cookie; the handler only says what the
    // session holds. Nothing about the user beyond the id — never the address, never the hash.
    return { userId: user.id, csrfToken: req.session.csrfToken };
  }

  @Post("auth/logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => (error ? reject(error) : resolve()));
    });

    // Destroying the record leaves the browser holding a cookie that now resolves to nothing.
    // Clearing it too is what makes the next request anonymous rather than merely rejected.
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });

    return { ok: true };
  }

  /**
   * For a reload: the cookie survives, the token the front held in memory does not.
   *
   * A GET, so the guard does not demand the very token this route exists to hand out.
   */
  @Get("csrf")
  csrf(@Req() req: Request) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
    }
    return { csrfToken: req.session.csrfToken };
  }

  @Get("me")
  me(@Req() req: Request) {
    return { userId: req.session.userId };
  }
}
