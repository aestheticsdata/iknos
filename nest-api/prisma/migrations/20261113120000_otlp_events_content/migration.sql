-- IKN-87 v2 — span events, and span content kept apart under its own retention.
--
-- `span_event` is day-partitioned like `span`, on the **span's** `ts`, and must stay in
-- `MANAGED_TABLES` (maintenance.service.ts) — the same hand-edit as `20261112120000_otlp_traces`,
-- and the same warning: regenerating this migration drops the clause silently.
--
-- `span_content` is NOT partitioned: its rows expire per batch (`expires_at`), not per day, and the
-- hourly purge deletes them in bounded batches through the `expires_at` index.
--
-- Purely additive. The two `span` columns are nullable and appended (an instant ALTER on MySQL 8);
-- the previous release ignores them, so a rollback runs unchanged against this schema.

-- AlterTable
ALTER TABLE `span` ADD COLUMN `content_until` DATETIME(3) NULL,
    ADD COLUMN `content_days` SMALLINT NULL;

-- CreateTable
CREATE TABLE `span_event` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `trace_id` CHAR(32) NOT NULL,
    `span_id` CHAR(16) NOT NULL,
    `event_index` SMALLINT NOT NULL,
    `time_us` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `attrs` JSON NULL,

    INDEX `span_event_service_ts_idx`(`service`, `ts`),
    UNIQUE INDEX `span_event_trace_id_span_id_event_index_ts_key`(`trace_id`, `span_id`, `event_index`, `ts`),
    PRIMARY KEY (`id`, `ts`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci

-- Hand-written: see the header. The maintenance pass at the next boot carves the daily window
-- out of `p_future`.
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- CreateTable
CREATE TABLE `span_content` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `trace_id` CHAR(32) NOT NULL,
    `span_id` CHAR(16) NOT NULL,
    `span_ts` DATETIME(3) NOT NULL,
    `event_index` SMALLINT NOT NULL,
    `content_key` VARCHAR(255) NOT NULL,
    `value` MEDIUMTEXT NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `span_content_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `span_content_owner_key`(`trace_id`, `span_id`, `span_ts`, `event_index`, `content_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
