/** The longest a refused live tail waits before asking again. */
export const RECONNECT_CEILING_MS = 30_000;

const FIRST_DELAY_MS = 1000;

/**
 * How long to wait before reopening a stream the browser has given up on (IKN-79), by the number
 * of attempts that have already failed in a row: 1 s, doubling, capped at thirty.
 */
export const reconnectDelay = (attempt: number) => Math.min(FIRST_DELAY_MS * 2 ** attempt, RECONNECT_CEILING_MS);
