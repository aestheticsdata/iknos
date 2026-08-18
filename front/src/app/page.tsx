import { HOME } from "@lib/routes";
import { redirect } from "next/navigation";

/**
 * `/` has no content of its own: the rail scopes views, and logs is the only view M1 can fill.
 * Signed-out visitors never reach this — the middleware sends them to `/login` first.
 */
export default function RootPage() {
  redirect(HOME);
}
