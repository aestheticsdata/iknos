"use client";

import { AuthBanner } from "@components/auth/AuthBanner";
import { AuthField, AuthInput } from "@components/auth/AuthField";
import { RevealToggle } from "@components/auth/RevealToggle";
import { StrengthMeter } from "@components/auth/StrengthMeter";
import { registerSchema } from "@components/auth/schemas";
import { useAuthForm } from "@components/auth/useAuthForm";
import { Button } from "@components/ui/Button";
import { postJson, readApiError } from "@lib/api";
import { SECRET_RULES } from "@lib/fieldLimits";
import { ROUTES } from "@lib/routes";
import { AUTH_TEXT } from "@text/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { RegisterValues } from "@components/auth/schemas";

const t = AUTH_TEXT.register;

/**
 * `/register` — a first-run bootstrap that seals itself.
 *
 * Iknos is single-account by design: `app_user.singleton` is UNIQUE, so the *database* refuses a
 * second one. This screen is the polite version of that refusal — and `sealed` arrives from the
 * server component above, already decided, so a real submittable form never appears on an instance
 * that has its account (see `lib/bootstrap.ts` for why that matters).
 *
 * The sealed form is left on screen at 42% opacity with a dead button rather than removed. Someone
 * who arrives here is usually locked out, and an empty page tells them nothing about what to do
 * next; the banner points at recovery.
 */
export const RegisterForm = ({ sealed }: { sealed: boolean }) => {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [revealPassword, setRevealPassword] = useState(false);
  const [revealPassphrase, setRevealPassphrase] = useState(false);

  const { register, handleSubmit, formState, watch, clearOnEmpty } = useAuthForm<RegisterValues>(registerSchema, {
    defaultValues: {
      email: "",
      password: "",
      passwordConfirm: "",
      recoveryPassphrase: "",
      recoveryPassphraseConfirm: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await postJson("/auth/register", {
        email: values.email,
        password: values.password,
        recoveryPassphrase: values.recoveryPassphrase,
      });
      /*
       * No session is opened — that is the API's behaviour and it is deliberate. Signing in
       * straight away proves the password works while the passphrase is still on screen to be
       * written down, which is the only moment it can be checked without a lockout.
       */
      router.replace(`${ROUTES.login}?registered=1`);
      router.refresh();
    } catch (error) {
      setFailure(readApiError(error, t.failed));
    }
  });

  const password = watch("password");
  const busy = formState.isSubmitting;
  const dead = sealed || busy;

  return (
    <form
      noValidate
      onSubmit={onSubmit}
    >
      {sealed ? (
        <AuthBanner
          title={t.sealedTitle}
          tone="warn"
        >
          {t.sealedBody}
        </AuthBanner>
      ) : null}
      {failure ? (
        <AuthBanner
          tone="error"
          title={failure}
        />
      ) : null}

      {/*
       * `inert` and not merely `opacity` — the mockup's 42% is the look of it, but a form that is
       * only faded is still tabbable, still fillable and still submittable by pressing Enter in a
       * field. `inert` takes the whole subtree out of the tab order and out of reach of the mouse,
       * which is the actual seal on the client side.
       */}
      <div
        className={sealed ? "opacity-42" : undefined}
        inert={sealed}
      >
        <AuthField
          error={formState.errors.email?.message}
          label={AUTH_TEXT.fields.email}
        >
          <AuthInput
            aria-invalid={Boolean(formState.errors.email)}
            autoComplete="username"
            placeholder={AUTH_TEXT.fields.emailPlaceholder}
            type="email"
            {...register("email", { onBlur: () => clearOnEmpty("email") })}
          />
        </AuthField>

        <div className="flex gap-3">
          <div className="flex-1">
            <AuthField
              error={formState.errors.password?.message}
              label={AUTH_TEXT.fields.password}
            >
              <AuthInput
                aria-invalid={Boolean(formState.errors.password)}
                autoComplete="new-password"
                placeholder={`${SECRET_RULES.passwordMin}+ chars`}
                type={revealPassword ? "text" : "password"}
                {...register("password", { onBlur: () => clearOnEmpty("password") })}
              />
            </AuthField>
          </div>
          <div className="flex-1">
            <AuthField
              action={
                <RevealToggle
                  onToggle={() => setRevealPassword((shown) => !shown)}
                  revealed={revealPassword}
                />
              }
              error={formState.errors.passwordConfirm?.message}
              label={AUTH_TEXT.fields.confirm}
            >
              <AuthInput
                aria-invalid={Boolean(formState.errors.passwordConfirm)}
                autoComplete="new-password"
                type={revealPassword ? "text" : "password"}
                {...register("passwordConfirm", { onBlur: () => clearOnEmpty("passwordConfirm") })}
              />
            </AuthField>
          </div>
        </div>

        <div className="mb-3.5 flex flex-col gap-1.25">
          <span className="text-kicker tracking-kicker text-chassis-text-dim">{AUTH_TEXT.fields.strength}</span>
          <StrengthMeter secret={password} />
        </div>

        <AuthField
          action={
            <RevealToggle
              onToggle={() => setRevealPassphrase((shown) => !shown)}
              revealed={revealPassphrase}
            />
          }
          error={formState.errors.recoveryPassphrase?.message}
          hint={`${SECRET_RULES.passphraseMin}+ CHARS`}
          label={AUTH_TEXT.fields.passphrase}
        >
          <AuthInput
            aria-invalid={Boolean(formState.errors.recoveryPassphrase)}
            autoComplete="off"
            type={revealPassphrase ? "text" : "password"}
            {...register("recoveryPassphrase", { onBlur: () => clearOnEmpty("recoveryPassphrase") })}
          />
        </AuthField>

        <AuthField
          error={formState.errors.recoveryPassphraseConfirm?.message}
          label={AUTH_TEXT.fields.passphraseConfirm}
        >
          <AuthInput
            aria-invalid={Boolean(formState.errors.recoveryPassphraseConfirm)}
            autoComplete="off"
            type={revealPassphrase ? "text" : "password"}
            {...register("recoveryPassphraseConfirm", {
              onBlur: () => clearOnEmpty("recoveryPassphraseConfirm"),
            })}
          />
        </AuthField>

        <p className="mb-4 text-micro/hint text-chassis-text-dim">{t.passphraseWarning}</p>

        <div className="flex items-center gap-3.5">
          <Button
            disabled={dead}
            type="submit"
          >
            {busy ? t.submitting : t.submit}
          </Button>
          <span className="text-row text-chassis-text-dim">{AUTH_TEXT.login.or}</span>
          <Link
            className="text-label tracking-control text-chassis-accent transition-colors duration-150 ease-out hover:text-chassis-text"
            href={ROUTES.login}
          >
            {t.signIn}
          </Link>
        </div>
      </div>

      {/*
       * The way out, outside the inert subtree — otherwise sealing the form also seals the one
       * link that helps the person reading the banner.
       */}
      {sealed ? (
        <div className="mt-4 flex items-center gap-3.5 border-t border-chassis-border pt-3.5">
          <Link
            className="text-label tracking-control text-chassis-accent transition-colors duration-150 ease-out hover:text-chassis-text"
            href={ROUTES.recover}
          >
            {AUTH_TEXT.login.recover}
          </Link>
          <Link
            className="text-label tracking-control text-chassis-text-dim transition-colors duration-150 ease-out hover:text-chassis-text"
            href={ROUTES.login}
          >
            {t.signIn}
          </Link>
        </div>
      ) : null}
    </form>
  );
};
