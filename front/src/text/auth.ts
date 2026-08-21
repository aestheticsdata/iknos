/**
 * Every string the auth screens say.
 *
 * One file rather than literals in six components, for the reason the copy is worth being careful
 * about at all: three of these sentences are the only thing standing between someone locked out and
 * giving up, and they have to agree with each other. There is no i18n layer — Iknos has one
 * operator and the product is in English.
 *
 * Lowercase is deliberate and comes from the mockup: the chassis speaks in lowercase, the way a
 * terminal does.
 */
export const AUTH_TEXT = {
  chrome: {
    host: "KS-B.INTERNAL",
    crumb: "AUTH",
    crumbAbout: "ABOUT",
  },

  tagline:
    "a self-hosted monitor for the apps on ks-b — ECS logs, Prometheus metrics, grouped errors and alerts. no SaaS, no agent, no lock-in.",

  /**
   * The mockup says `bcrypt`. Iknos hashes with **scrypt** — `node:crypto`, no dependency — so the
   * footer says scrypt. Stating the security posture on a self-hosted tool's login screen is
   * honest and costs one line; stating the wrong one costs the credit of the other three claims.
   */
  posture: "httpOnly cookie · rolling session · CSRF · scrypt",

  aboutLink: "ABOUT IKNOS →",
  aboutBack: "‹ BACK TO SIGN IN",

  login: {
    kicker: "IKNOS",
    title: "sign in",
    submit: "Sign in",
    submitting: "verifying…",
    register: "REGISTER",
    recover: "RECOVER ACCOUNT →",
    or: "OR",
    /**
     * One message for a wrong password and for an address with no account. Telling them apart is
     * telling an attacker which half to keep working on.
     */
    failed: "invalid credentials",
    rateLimited: "too many attempts · wait a minute and try again",
    registered: "account created · sign in with your new password",
    reset: "password reset · sign in with the new one",
    /**
     * Shown when Iknos sent you here rather than when you walked in — IKN-44.
     *
     * "session expired" and not "you were logged out": nobody logged anyone out, a two-hour rolling
     * window ran out while the tab sat there. It says what happened and what to do about it, in
     * that order, because the person reading it was in the middle of something else.
     */
    expired: "session expired · sign in again",
  },

  register: {
    kicker: "NEW ACCOUNT",
    title: "create an account",
    submit: "REGISTER",
    submitting: "creating…",
    signIn: "SIGN IN",
    /**
     * The mockup's banner reads `IKNOS_ALLOW_SIGNUP=false`. No such variable exists and none will:
     * registration is sealed by the account existing. A flag is one more thing to forget, and one
     * more thing to flip back on by accident.
     */
    sealedTitle: "this instance already has its account",
    sealedBody: "use recovery if you are locked out.",
    passphraseWarning: "the only way back in if you lose your password — there is no recovery email. write it down.",
    failed: "registration failed",
  },

  recover: {
    kicker: "RECOVERY",
    title: "reset your password",
    submit: "RESET",
    submitting: "resetting…",
    signIn: "SIGN IN",
    hint: "the passphrase you chose when you registered. an account without one can only be reset by the owner, in the database.",
    /** Same silence as login: a wrong phrase, an unknown address and no phrase on file read alike. */
    failed: "recovery failed",
    rateLimited: "too many attempts · wait fifteen minutes and try again",
  },

  about: {
    kicker: "ABOUT",
    title: "legal notice",
  },

  fields: {
    email: "IDENTITY · EMAIL",
    emailPlaceholder: "you@domain.tld",
    password: "PASSWORD",
    newPassword: "NEW PASSWORD",
    confirm: "CONFIRM",
    strength: "STRENGTH",
    passphrase: "RECOVERY PASSPHRASE",
    passphraseConfirm: "CONFIRM PASSPHRASE",
    reveal: "SHOW",
    conceal: "HIDE",
  },

  validation: {
    required: "required",
    notAnEmail: "not an email address",
    tooLong: "too long",
    noMatch: "the two entries do not match",
    minChars: "at least {n} characters",
  },
} as const;

/** The legal notice — §5.7's key/value list. */
export const LEGAL: readonly { k: string; v: string }[] = [
  { k: "service", v: "Iknos — self-hosted monitoring" },
  { k: "host", v: "OVH SAS" },
  { k: "office", v: "2 rue Kellermann, 59100 Roubaix, France" },
  { k: "ape", v: "2620Z" },
  { k: "vat", v: "FR 22 424 761 419" },
];
