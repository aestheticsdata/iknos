/** The four `statfs` fields the host sampler reads, as plain numbers (IKN-8, IKN-25). */
export type StatfsReading = {
  bsize: number;
  blocks: number;
  /** Free blocks, including the ones reserved for root. */
  bfree: number;
  /** Free blocks an unprivileged process can actually use. */
  bavail: number;
};
