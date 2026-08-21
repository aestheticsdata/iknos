import { AuthChassis } from "@components/auth/AuthChassis";
import { LoginForm } from "@components/auth/LoginForm";
import { readBootstrap } from "@lib/bootstrap";

import type { LoginNotice } from "@components/auth/LoginForm";

/** Same reason as `/register`: the seal must be read per request, never baked in at build time. */
export const dynamic = "force-dynamic";

/**
 * `?registered=1`, `?reset=1` and `?expired=1` are read here rather than in the form because a
 * server component gets them without `useSearchParams`, which would otherwise force the whole form
 * into a Suspense boundary to satisfy static rendering.
 */
const LoginPage = async ({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) => {
  const [params, bootstrap] = await Promise.all([searchParams, readBootstrap()]);

  /*
   * `expired` is set by the app itself rather than by another screen — `@lib/api` on a 401, and
   * `AppChassis` when the API rejects the cookie a page load arrived with (IKN-44). It is last in
   * the chain because the other two follow something the person just did, and being told "account
   * created" is more use than being told the session they no longer have has ended.
   */
  const notice: LoginNotice | undefined = params.registered
    ? "registered"
    : params.reset
      ? "reset"
      : params.expired
        ? "expired"
        : undefined;

  return (
    <AuthChassis page="login">
      <LoginForm
        canRegister={!bootstrap.sealed}
        notice={notice}
      />
    </AuthChassis>
  );
};

export default LoginPage;
