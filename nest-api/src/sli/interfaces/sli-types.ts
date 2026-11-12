/** The query string as it arrives. Strings, because the global pipe runs without `transform`. */
export type SliQueryInput = {
  service?: string;
  from?: string;
  to?: string;
  pathPrefix?: string;
  excludePathPrefix?: string;
};

/** The window `GET /api/sli` measures, once its query string has been checked. */
export type SliQuery = {
  service: string;
  from: Date;
  to: Date;
  /** Only routes equal to this or below it (`/api` → `/api`, `/api/x`, never `/apiary`). */
  pathPrefix: string | null;
  /** Everything but the routes under this one — the other half of a vhost shared by a front and an API. */
  excludePathPrefix: string | null;
};

/** What the collector says about itself, reduced to the two facts `ingestedThrough` needs. */
export type CollectorProgress = {
  /** When the tailer last finished a pass over every file. */
  lastPollAt: Date | null;
  /** When the writer last committed a batch. */
  lastWrittenAt: Date | null;
  /** Records read off disk and not yet committed. */
  queued: number;
};
