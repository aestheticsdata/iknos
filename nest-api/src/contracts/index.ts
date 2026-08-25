/**
 * The response contract, in one import.
 *
 * **This is the authoritative copy.** There is no shared workspace package — `nest-api` and
 * `front` are independent pnpm roots with their own lockfiles, the same call trekker made, so the
 * front restates these shapes rather than importing them. That is a deliberate duplication of
 * about sixty lines, and the thing it buys is that neither half can break the other's build.
 *
 * When a field changes here, it changes in the front's copy too. These files are where the truth
 * lives; that one is a transcription.
 */

export type {
  CollectorFile,
  CollectorStatus,
  CollectorStorage,
  DiskUsage,
  IngestRate,
  StorageTable,
} from "./collector";
export type { Bucket, Histogram } from "./histogram";
export type { IssueDetail } from "./issue-detail";
export type { IssueCounts, IssuePage } from "./issue-page";
export type { IssueRow, IssueStatus } from "./issue-row";
export type { LogDetail } from "./log-detail";
export type { LogPage } from "./log-page";
export type { LogRow } from "./log-row";
export type { Meta } from "./meta";
export type { OccurrenceSeries } from "./occurrence-series";
export type { SearchHit, SearchHitType, SearchResults } from "./search";
export type { Service, ServiceList } from "./service";
export type {
  NodeRuntime,
  PoolGauge,
  ProbeCheck,
  ProbeSummary,
  ProcessFacts,
  ServiceRuntime,
} from "./service-runtime";
export type { MetricSource, ServiceSignals, Signal, SignalPoint } from "./service-signals";
export type { Trace } from "./trace";
