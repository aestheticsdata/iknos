import { expect, test as setup } from "@playwright/test";

/**
 * Signing the demo in — as the house dev account, which on Iknos is the only account there is.
 *
 * `app_user.singleton` is UNIQUE: an instance has exactly one operator, so this run signs in as
 * `local.dev@mock.io` itself. The corpus it films is the seven-day fixture IKN-61 loads, in the dev
 * database only; its addresses are documentation ranges and its paths are invented.
 *
 * ⚠️ Iknos keeps ONE live session per account: this sign-in revokes every other one
 * (`nest-api/src/auth/auth.controller.ts`). Your own Iknos tab is signed out the moment this runs,
 * and a sign-in of yours mid-take bounces the filmed page to `/login/?expired=1`.
 */
const STORAGE_STATE = "e2e/.auth/demo.json";

setup("sign in as the demo operator", async ({ page }) => {
  const username = process.env.DEMO_USERNAME;
  const password = process.env.DEMO_PASSWORD;
  setup.skip(!username || !password, "set DEMO_USERNAME and DEMO_PASSWORD in .env.test.local");

  await page.goto("/login/");
  await page.fill('input[name="email"]', username as string);
  await page.fill('input[name="password"]', password as string);
  await page.click('button[type="submit"]');

  // The form finishes with `router.replace("/logs")`, a soft navigation that never fires a `load`
  // event — so the rail appearing is the real signal that the chassis rendered, and it is what
  // the saved session has to be good for. `trailingSlash: true` makes the landing URL `/logs/`.
  await expect(page.locator('nav[aria-label="Services and views"]')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/logs\/$/);
  await page.context().storageState({ path: STORAGE_STATE });
});
