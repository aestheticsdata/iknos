import { initErrorReporting, noteNavigation } from "@lib/report";

/**
 * Client-side instrumentation, the one thing tailing PM2's files cannot reach.
 *
 * Next runs this **after the HTML is loaded and before React hydrates**, which is the whole
 * reason the file convention exists: an error thrown while the app is coming up happens before
 * any component could have installed a handler, and this is the only code that is already there.
 *
 * Deliberately tiny. Next warns when client instrumentation takes more than 16 ms, and it is
 * right to: this runs on the critical path of every page load, for a feature that matters only
 * when something has already gone wrong.
 *
 * There is no `instrumentation.ts` beside it, and that is not an oversight. Server Components,
 * Route Handlers and Server Actions print to stdout, PM2 writes that to disk, and the collector
 * reads it — the server half is already covered by the thing Iknos was built to do.
 */

initErrorReporting();

/**
 * Called by Next at the start of every App Router navigation.
 *
 * The page an error happened on is rarely the whole story; the page before it often is.
 */
export function onRouterTransitionStart(url: string): void {
  noteNavigation(url);
}
