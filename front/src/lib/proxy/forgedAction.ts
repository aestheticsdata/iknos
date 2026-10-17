/** The header a Server Action call carries its id in. */
const ACTION_HEADER = "next-action";

/** What Next 16 mints: an info byte and a 40-character hash, all hex — 42 characters. */
const ACTION_ID = /^[0-9a-f]{42}$/;

/**
 * Whether a request claims to call a Server Action with an id Next could never have minted (IKN-76).
 *
 * Scanners probe every Next site with a junk `Next-Action` header. Next turns them away on its
 * own, but logs each one as an error with its stack — several rows in Iknos per probe, an alert
 * after a few dozen. Turned away in the proxy instead, they never reach Next and leave nothing
 * behind. A well-formed id that matches no action still goes through: that is a stale tab after
 * a deploy, and Next's error is the one worth reading then.
 */
export const isForgedAction = (headers: Headers): boolean => {
  const id = headers.get(ACTION_HEADER);
  return id !== null && !ACTION_ID.test(id);
};
