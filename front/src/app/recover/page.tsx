import { AuthChassis } from "@components/auth/AuthChassis";
import { RecoverForm } from "@components/auth/RecoverForm";

/**
 * Reachable whether or not the instance is sealed, and deliberately not gated on `bootstrap`.
 *
 * Someone arriving here is by definition locked out, and the API answers an address with no account
 * exactly as it answers a wrong passphrase — so there is nothing a seal check could add but a
 * second way to learn whether an account exists.
 */
const RecoverPage = () => (
  <AuthChassis page="recover">
    <RecoverForm />
  </AuthChassis>
);

export default RecoverPage;
