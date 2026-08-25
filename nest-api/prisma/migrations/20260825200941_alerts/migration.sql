-- IKN-10 — the alert engine's two tables.
--
-- Two hand-edits Prisma cannot express, both load-bearing. Regenerating this migration drops
-- them silently.
--
--  1. `alert.open_key` is a GENERATED column. It is how "one open alert per (rule_key, service)"
--     becomes the database's guarantee instead of the engine's: MySQL 8 has no partial unique
--     index, but NULLs are distinct in a unique index, so a resolved row's NULL never collides
--     while two open rows for the same rule and service collide exactly when they should.
--     Nothing in the application assigns it.
--
--  2. `alert_state_change` is day-partitioned, like every other stream table here. It must also
--     be added to `MANAGED_TABLES` in maintenance.service.ts, or nothing creates tomorrow's
--     partition and every row lands in `p_future` forever.
--
-- `alert` itself is deliberately NOT partitioned and NOT pruned — it is the ledger, kept like
-- `issue`. An alert from March is the answer to "has this happened before".

-- CreateTable
CREATE TABLE `alert` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rule_key` VARCHAR(32) NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `severity` VARCHAR(16) NOT NULL,
    `title` VARCHAR(128) NOT NULL,
    `expr` VARCHAR(255) NOT NULL,
    `threshold` DOUBLE NULL,
    `unit` VARCHAR(16) NULL,
    `value` DOUBLE NULL,
    `state` VARCHAR(16) NOT NULL,
    `opened_at` DATETIME(3) NOT NULL,
    `pending_since` DATETIME(3) NULL,
    `fired_at` DATETIME(3) NULL,
    `resolved_at` DATETIME(3) NULL,
    `acked_at` DATETIME(3) NULL,
    `silenced_until` DATETIME(3) NULL,
    `occurrences` INTEGER NOT NULL DEFAULT 1,
    `last_seen_at` DATETIME(3) NOT NULL,
    `open_key` VARCHAR(96) AS (IF(`resolved_at` IS NULL, CONCAT(`rule_key`, '|', `service`), NULL)) STORED,

    UNIQUE INDEX `alert_open_key_key`(`open_key`),
    INDEX `alert_state_severity_last_seen_at_idx`(`state`, `severity`, `last_seen_at`),
    INDEX `alert_service_last_seen_at_idx`(`service`, `last_seen_at`),
    INDEX `alert_rule_key_service_opened_at_idx`(`rule_key`, `service`, `opened_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `alert_state_change` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `alert_id` INTEGER NOT NULL,
    `from_state` VARCHAR(16) NULL,
    `to_state` VARCHAR(16) NOT NULL,
    `value` DOUBLE NULL,

    INDEX `alert_state_change_alert_id_ts_idx`(`alert_id`, `ts`),
    PRIMARY KEY (`id`, `ts`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
