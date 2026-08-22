-- IKN-8: the five time-series tables of M2, additive.
--
-- Every CREATE TABLE below ends in a hand-written partition clause, same convention as
-- log_entry in the init migration: Prisma cannot express partitioning and will not round-trip
-- it, so that clause is the part a regenerated migration would silently drop. If
-- `SHOW CREATE TABLE <name>` ever comes back without it, that is what happened.
--
-- Only `p_future` exists at creation: the tables are writable from the first insert, and the
-- sliding daily window is the maintenance pass's job — extended by this same ticket to cover
-- the raw sample tables alongside log_entry. `metric_rollup` stays out of that window: it is
-- empty until IKN-20, which owns its retention.

-- CreateTable
CREATE TABLE `metric_sample` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `labels` JSON NULL,
    `labels_hash` CHAR(16) NOT NULL,
    `value` DOUBLE NOT NULL,

    INDEX `metric_sample_service_name_labels_hash_ts_idx`(`service`, `name`, `labels_hash`, `ts`),
    PRIMARY KEY (`id`, `ts`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- CreateTable
CREATE TABLE `metric_rollup` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `labels` JSON NULL,
    `labels_hash` CHAR(16) NOT NULL,
    `count` INTEGER NOT NULL,
    `sum` DOUBLE NOT NULL,
    `min` DOUBLE NOT NULL,
    `max` DOUBLE NOT NULL,
    `last` DOUBLE NOT NULL,

    UNIQUE INDEX `metric_rollup_service_name_labels_hash_ts_key`(`service`, `name`, `labels_hash`, `ts`),
    PRIMARY KEY (`id`, `ts`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- CreateTable
CREATE TABLE `health_check` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `http_status` SMALLINT NULL,
    `ok` BOOLEAN NOT NULL,
    `latency_ms` INTEGER NULL,
    `error` VARCHAR(255) NULL,
    `checks` JSON NULL,
    `version` VARCHAR(64) NULL,

    INDEX `health_check_service_ts_idx`(`service`, `ts`),
    PRIMARY KEY (`id`, `ts`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- CreateTable
CREATE TABLE `host_sample` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `cpu_pct` DOUBLE NULL,
    `load1` DOUBLE NOT NULL,
    `load5` DOUBLE NOT NULL,
    `load15` DOUBLE NOT NULL,
    `mem_used_bytes` BIGINT UNSIGNED NOT NULL,
    `mem_total_bytes` BIGINT UNSIGNED NOT NULL,
    `disk_used_bytes` BIGINT UNSIGNED NULL,
    `disk_total_bytes` BIGINT UNSIGNED NULL,

    INDEX `host_sample_ts_idx`(`ts`),
    PRIMARY KEY (`id`, `ts`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- CreateTable
CREATE TABLE `process_sample` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `pm2_name` VARCHAR(64) NOT NULL,
    `pm2_id` INTEGER NULL,
    `status` VARCHAR(16) NOT NULL,
    `restarts` INTEGER NOT NULL,
    `cpu_pct` DOUBLE NULL,
    `mem_bytes` BIGINT UNSIGNED NULL,
    `started_at` DATETIME(3) NULL,
    `node_version` VARCHAR(16) NULL,

    INDEX `process_sample_pm2_name_ts_idx`(`pm2_name`, `ts`),
    PRIMARY KEY (`id`, `ts`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
