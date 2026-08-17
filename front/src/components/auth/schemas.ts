import { FIELD_LIMITS, SECRET_RULES } from "@lib/fieldLimits";
import { AUTH_TEXT } from "@text/auth";
import { z } from "zod";

const v = AUTH_TEXT.validation;

const minChars = (n: number): string => v.minChars.replace("{n}", String(n));

/**
 * Deliberately lenient, matching the mockup: an address either has an `@` or it does not. A
 * stricter pattern here rejects valid addresses to protect a server that checks properly anyway —
 * and the only address that will ever be typed into this instance is the owner's.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

const email = z.string().min(1, v.required).max(FIELD_LIMITS.email, v.tooLong).regex(EMAIL_PATTERN, v.notAnEmail);

/** A secret being CHOSEN takes the minimum. */
const newPassword = z.string().min(1, v.required).min(SECRET_RULES.passwordMin, minChars(SECRET_RULES.passwordMin));

const passphrase = z.string().min(1, v.required).min(SECRET_RULES.passphraseMin, minChars(SECRET_RULES.passphraseMin));

/**
 * Sign-in bounds the address and not the secret.
 *
 * A length rule can only ever apply to a secret being *chosen*, never to one being proved. An
 * account whose password predates a rule must still be able to sign in — and on the day the
 * minimum is raised, the operator's existing password must not become un-typeable on the very
 * screen they would use to change it.
 */
export const loginSchema = z.object({
  email,
  password: z.string().min(1, v.required),
});

export const registerSchema = z
  .object({
    email,
    password: newPassword,
    passwordConfirm: z.string().min(1, v.required),
    recoveryPassphrase: passphrase,
    recoveryPassphraseConfirm: z.string().min(1, v.required),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: v.noMatch,
    path: ["passwordConfirm"],
  })
  .refine((data) => data.recoveryPassphrase === data.recoveryPassphraseConfirm, {
    message: v.noMatch,
    path: ["recoveryPassphraseConfirm"],
  });

/**
 * The passphrase has NO confirmation field here. It is being proved, not chosen — you either have
 * it or you do not, and a second box would only be a copy of a value being read off paper.
 */
export const recoverSchema = z
  .object({
    email,
    recoveryPassphrase: passphrase,
    password: newPassword,
    passwordConfirm: z.string().min(1, v.required),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: v.noMatch,
    path: ["passwordConfirm"],
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type RecoverValues = z.infer<typeof recoverSchema>;
