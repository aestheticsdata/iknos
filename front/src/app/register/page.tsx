import { AuthChassis } from "@components/auth/AuthChassis";
import { RegisterForm } from "@components/auth/RegisterForm";
import { readBootstrap } from "@lib/bootstrap";

/**
 * The seal is decided **here**, on the server, before anything is sent — never in the browser.
 *
 * `dynamic = "force-dynamic"` is what makes that true in production. Without it Next prerenders
 * this page at build time, when `readBootstrap()` runs against an API that is not up yet: the build
 * would bake in whichever answer it got and serve it forever, which is either a permanently sealed
 * screen or — far worse — a permanently open registration form.
 */
export const dynamic = "force-dynamic";

const RegisterPage = async () => {
  const { sealed } = await readBootstrap();

  return (
    <AuthChassis page="register">
      <RegisterForm sealed={sealed} />
    </AuthChassis>
  );
};

export default RegisterPage;
