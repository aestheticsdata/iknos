/**
 * The largest JSON body the API will parse, on every route (IKN-29).
 *
 * Express defaults to 100 kB, a number nobody here chose. `POST /api/ingest` accepts batches of
 * `MAX_EVENTS_PER_REQUEST` events, each carrying a browser stack trace, and forty of those fill
 * 100 kB — so the two ceilings disagreed, and a full batch was refused with a 413 before the
 * controller ever got to count it. The browser client swallows failures by design, which made
 * that loss silent, and it fell on precisely the batches worth having: a page erroring in a loop.
 *
 * A megabyte leaves roughly 10 kB per event and stays far too small to be worth pointing at the
 * process. That it is deliberate is the point — the ingest token travels inside a JavaScript
 * bundle, so this ceiling is one of the few things between a public route and the memory behind
 * it.
 */
export const JSON_BODY_LIMIT = "1mb";
