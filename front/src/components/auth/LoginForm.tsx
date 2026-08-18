"use client";

import { AuthBanner } from "@components/auth/AuthBanner";
import { AuthField, AuthInput } from "@components/auth/AuthField";
import { loginSchema } from "@components/auth/schemas";
import { useAuthForm } from "@components/auth/useAuthForm";
import { Button } from "@components/ui/Button";
import { postJson, readApiError, statusOf } from "@lib/api";
import { ROUTES } from "@lib/routes";
import { AUTH_TEXT } from "@text/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { LoginValues } from "@components/auth/schemas";

const t = AUTH_TEXT.login;

/**
 * `/login` — three outcomes, all of them explicit (§5.7).
 *
 * @param notice what just happened on another screen: a registration, or a password reset.
 * @param canRegister false once the instance is sealed, which greys the REGISTER link rather than
 *   hiding it. A missing link reads as a broken page; a dim one reads as a door that is shut.
 */
export const LoginForm = ({ notice, canRegister }: { notice?: "registered" | "reset"; canRegister: boolean }) => {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  const { register, handleSubmit, formState, clearOnEmpty } = useAuthForm<LoginValues>(loginSchema, {
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await postJson("/auth/login", values);
      /*
       * Straight to the logs view, the same shape as Zeus's sign-in. Not `/`: that costs an extra
       * server redirect for nothing — and it is how sign-in silently looped back to this screen in
       * production, when a mock-era `redirects()` in next.config.js still sent `/` to `/login/`.
       * No `router.refresh()` either: it refetches the *current* route, so called here it races
       * the navigation it sits next to, and nothing on `/login` needs refetching mid-departure.
       */
      router.replace(ROUTES.logs);
    } catch (error) {
      // 429 is worth its own message. "invalid credentials" on a correct password, because the
      // sixth attempt in a minute was refused, sends someone to reset a password that works.
      setFailure(statusOf(error) === 429 ? t.rateLimited : readApiError(error, t.failed));
    }
  });

  const busy = formState.isSubmitting;

  return (
    <form
      noValidate
      onSubmit={onSubmit}
    >
      {notice ? (
        <AuthBanner
          tone="ok"
          title={notice === "registered" ? t.registered : t.reset}
        />
      ) : null}
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
        error={formState.errors.password?.message}
        label={AUTH_TEXT.fields.password}
      >
        <AuthInput
          aria-invalid={Boolean(formState.errors.password)}
          autoComplete="current-password"
          type="password"
          {...register("password", { onBlur: () => clearOnEmpty("password") })}
        />
      </AuthField>

      <div className="mt-1 mb-4 flex items-center gap-3.5">
        <Button
          disabled={busy}
          type="submit"
        >
          {busy ? t.submitting : t.submit}
        </Button>
        <span className="text-row text-chassis-text-dim">{t.or}</span>
        {canRegister ? (
          <Link
            className="text-label tracking-control text-chassis-accent hover:brightness-125"
            href={ROUTES.register}
          >
            {t.register}
          </Link>
        ) : (
          <span className="text-label tracking-control text-chassis-border-focus">{t.register}</span>
        )}
      </div>

      <div className="border-t border-chassis-border pt-3.5">
        <Link
          className="text-label tracking-control text-chassis-accent hover:text-chassis-text"
          href={ROUTES.recover}
        >
          {t.recover}
        </Link>
      </div>
    </form>
  );
};
