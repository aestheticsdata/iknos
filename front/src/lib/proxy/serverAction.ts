/** The header a Server Action call carries its id in. */
const ACTION_HEADER = "next-action";

/**
 * Whether a request claims to call a Server Action at all (IKN-77).
 *
 * The front has no Server Actions — every call goes to the API over `fetch` — so a request carrying
 * a `Next-Action` header is never ours: it is a scanner probing every Next site with a junk id. Next
 * turns it away on its own, but logs each one as an error with its stack — several rows in Iknos
 * per probe, an alert after a few dozen. Turned away in the proxy instead, it never reaches Next and
 * leaves nothing behind. Presence is the whole test: there is no action to protect, so no id shape
 * is worth telling apart.
 */
export const isServerActionRequest = (headers: Headers): boolean => headers.has(ACTION_HEADER);
