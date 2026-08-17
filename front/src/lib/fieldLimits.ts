/**
 * The rules the API enforces, restated so the form can say them before a round trip.
 *
 * These MUST track `nest-api/src/auth/passphrase.util.ts`. The server is the authority — the front
 * copy exists so a 12-character passphrase is caught under the field rather than as a 400 the
 * person reads after submitting, not so the front can have an opinion of its own.
 *
 * **No maximum, and no composition rules.** The API sets none: no required digit, no case, no
 * symbol. A front-side rule the server does not have is a field that rejects a secret the API
 * would have taken, which is the worst kind of divergence — it looks like a bug in the password.
 */
export const SECRET_RULES = {
  /** `MIN_PASSWORD` */
  passwordMin: 12,

  /**
   * `MIN_PASSPHRASE`. Higher than the password because the passphrase can reset it, and that is
   * the whole argument — a longer phrase stays a *recommendation the form makes*, never a rule.
   * What actually guards recovery is the rate limit: five attempts per address per fifteen minutes.
   */
  passphraseMin: 13,
} as const;

/** The RFC's ceiling. `IsEmail` on the API rejects anything longer well before this matters. */
export const FIELD_LIMITS = {
  email: 254,
} as const;
