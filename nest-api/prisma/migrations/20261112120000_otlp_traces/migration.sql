-- IKN-87 — OTLP trace ingestion: the per-application write tokens and the span table.
--
-- One hand-edit Prisma cannot express, and it is load-bearing: `span` is day-partitioned like every
-- other stream table here. Regenerating this migration drops the clause silently. The table must
-- also stay in `MANAGED_TABLES` (maintenance.service.ts), or nothing creates tomorrow's partition
-- and every span lands in `p_future` forever.
--
-- `ingest_token` is NOT partitioned and NOT pruned: it is a registry, like `service`. A revoked row
-- is kept, with its `revoked_at`, so the question "which token was that" keeps an answer.
--
-- Purely additive. Nothing existing is altered, so the previous release runs unchanged against the
-- new schema if a deploy is rolled back.
-- CreateTable
CREATE TABLE `ingest_token` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `service` VARCHAR(64) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `label` VARCHAR(128) NOT NULL,
    `allowed_origins` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,

    UNIQUE INDEX `ingest_token_token_hash_key`(`token_hash`),
    INDEX `ingest_token_service_idx`(`service`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `span` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `trace_id` CHAR(32) NOT NULL,
    `span_id` CHAR(16) NOT NULL,
    `parent_span_id` CHAR(16) NULL,
    `name` VARCHAR(255) NOT NULL,
    `kind` TINYINT NOT NULL,
    `start_us` BIGINT NOT NULL,
    `duration_us` BIGINT NOT NULL,
    `status_code` TINYINT NOT NULL,
    `status_message` VARCHAR(1024) NULL,
    `gen_ai_operation` VARCHAR(64) NULL,
    `gen_ai_model` VARCHAR(128) NULL,
    `input_tokens` INTEGER NULL,
    `output_tokens` INTEGER NULL,
    `attrs` JSON NULL,

    INDEX `span_service_ts_idx`(`service`, `ts`),
    UNIQUE INDEX `span_trace_id_span_id_ts_key`(`trace_id`, `span_id`, `ts`),
    PRIMARY KEY (`id`, `ts`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci

-- Hand-written: see the header. Only `p_future` exists at this point; the maintenance pass at the
-- next boot reorganises it into the sliding daily window.
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
