-- CreateTable
CREATE TABLE `service` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,
    `pm2_name` VARCHAR(64) NOT NULL,
    `metrics_url` VARCHAR(255) NULL,
    `health_url` VARCHAR(255) NULL,
    `log_glob` VARCHAR(512) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `service_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `singleton` BOOLEAN NOT NULL DEFAULT true,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `app_user_singleton_key`(`singleton`),
    UNIQUE INDEX `app_user_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ingest_offset` (
    `file_path` VARCHAR(512) NOT NULL,
    `dev` BIGINT UNSIGNED NOT NULL,
    `inode` BIGINT UNSIGNED NOT NULL,
    `byte_offset` BIGINT UNSIGNED NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`file_path`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `log_entry` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `level` SMALLINT NOT NULL,
    `level_name` VARCHAR(16) NOT NULL,
    `logger` VARCHAR(128) NULL,
    `message` TEXT NOT NULL,
    `trace_id` CHAR(32) NULL,
    `http_method` VARCHAR(10) NULL,
    `route` VARCHAR(255) NULL,
    `status_code` SMALLINT NULL,
    `duration_ms` INTEGER NULL,
    `client_ip` VARCHAR(45) NULL,
    `user_id` VARCHAR(64) NULL,
    `hostname` VARCHAR(128) NULL,
    `attrs` JSON NULL,

    INDEX `log_entry_service_ts_idx`(`service`, `ts`),
    INDEX `log_entry_level_ts_idx`(`level`, `ts`),
    INDEX `log_entry_trace_id_ts_idx`(`trace_id`, `ts`),
    INDEX `log_entry_route_ts_idx`(`route`, `ts`),
    PRIMARY KEY (`id`, `ts`)
)
-- Hand-written from here down. Prisma cannot express partitioning and will not round-trip it,
-- so this clause is the one part of the file that a regenerated migration would silently drop.
-- If `SHOW CREATE TABLE log_entry` ever comes back without it, that is what happened.
--
-- Only `p_future` exists at this point: the table is correct and writable from the first
-- insert, and the sliding daily window is Task 20's job. Retention is then `DROP PARTITION` —
-- instant, and it returns disk to the OS, which a batched DELETE never does.
ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
