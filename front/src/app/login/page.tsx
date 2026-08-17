import { AuthChassis } from "@components/auth/AuthChassis";
import { LoginForm } from "@components/auth/LoginForm";
import { readBootstrap } from "@lib/bootstrap";

/** Same reason as `/register`: the seal must be read per request, never baked in at build time. */
export const dynamic = "force-dynamic";

/**
 * `?registered=1` and `?reset=1` are read here rather than in the form because a server component
 * gets them without `useSearchParams`, which would otherwise force the whole form into a Suspense
 * boundary to satisfy static rendering.
 */
const LoginPage = async ({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) => {
  const [params, bootstrap] = await Promise.all([searchParams, readBootstrap()]);

  const notice = params.registered ? "registered" : params.reset ? "reset" : undefined;

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
