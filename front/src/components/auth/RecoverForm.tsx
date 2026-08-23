"use client";

import { AuthBanner } from "@components/auth/AuthBanner";
import { AuthField, AuthInput } from "@components/auth/AuthField";
import { RevealToggle } from "@components/auth/RevealToggle";
import { recoverSchema } from "@components/auth/schemas";
import { useAuthForm } from "@components/auth/useAuthForm";
import { Button } from "@components/ui/Button";
import { Pending } from "@components/ui/Pending";
import { postJson, readApiError, statusOf } from "@lib/api";
import { SECRET_RULES } from "@lib/fieldLimits";
import { ROUTES } from "@lib/routes";
import { AUTH_TEXT } from "@text/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { RecoverValues } from "@components/auth/schemas";

const t = AUTH_TEXT.recover;

/**
 * `/recover` — the only way back in, on a box with no mail server.
 *
 * The API answers a wrong passphrase, an unknown address and an account with no passphrase on file
 * with the same 401, and pays the same derivation cost for each. This form does not try to be more
 * helpful than that: a message that distinguishes them tells someone guessing which half to keep
 * working on. The hint under the fields carries what can safely be said.
 */
export const RecoverForm = () => {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [revealPassphrase, setRevealPassphrase] = useState(false);
  const [revealPassword, setRevealPassword] = useState(false);

  const { register, handleSubmit, formState, clearOnEmpty } = useAuthForm<RecoverValues>(recoverSchema, {
    defaultValues: { email: "", recoveryPassphrase: "", password: "", passwordConfirm: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await postJson("/auth/recover", {
        email: values.email,
        recoveryPassphrase: values.recoveryPassphrase,
        password: values.password,
      });
      // Recovery clears every live session server-side, so there is nothing to be signed in to
      // here — and signing in with the new password is the proof that it took.
      router.replace(`${ROUTES.login}?reset=1`);
      router.refresh();
    } catch (error) {
      setFailure(statusOf(error) === 429 ? t.rateLimited : readApiError(error, t.failed));
    }
  });

  const busy = formState.isSubmitting;

  return (
    <form
      noValidate
      onSubmit={onSubmit}
    >
      {failure ? (
        <AuthBanner
          tone="error"
          title={failure}
        />
      ) : null}

      <AuthField
        error={formState.errors.email?.message}
        label={AUTH_TEXT.fields.email}
      >
        <AuthInput
          aria-invalid={Boolean(formState.errors.email)}
          autoComplete="username"
          autoFocus
          placeholder={AUTH_TEXT.fields.emailPlaceholder}
          type="email"
          {...register("email", { onBlur: () => clearOnEmpty("email") })}
        />
      </AuthField>

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

      <div className="flex gap-3">
        <div className="flex-1">
          <AuthField
            error={formState.errors.password?.message}
            label={AUTH_TEXT.fields.newPassword}
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

      <p className="mb-4 text-micro/hint text-chassis-text-dim">{t.hint}</p>

      <div className="flex items-center gap-3.5">
        <Button
          disabled={busy}
          type="submit"
        >
          {busy ? <Pending>{t.submitting}</Pending> : t.submit}
        </Button>
        <span className="text-row text-chassis-text-dim">{AUTH_TEXT.login.or}</span>
        <Link
          className="text-label tracking-control text-chassis-accent transition-colors duration-150 ease-out hover:text-chassis-text"
          href={ROUTES.login}
        >
          {t.signIn}
        </Link>
      </div>
    </form>
  );
};
