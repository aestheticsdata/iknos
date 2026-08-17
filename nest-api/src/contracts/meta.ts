/**
 * Carried by every list response in the project, which is why it is its own exported type rather
 * than an inline shape repeated four times.
 *
 * `tookMs` is measured around the database call, not around the request: the status bar renders
 * it (`q 38ms`, IKN-22) so that a query which has quietly become slow is visible without anyone
 * having gone looking. Timing the whole request instead would blend in the network and the
 * serialisation, and the number would stop meaning "the database is struggling".
 */
export type Meta = {
  tookMs: number;
};
