-- IKN-96 and IKN-95 — Spira tickets on AI failure patterns, and test sets of AI runs.
--
-- Purely additive: one nullable column on `service`, three new tables. No partitioning — these are
-- registries, not streams, and they are not in MANAGED_TABLES. No foreign keys, as everywhere in
-- this schema; `test_set_run.set_id` is deleted with its set by the API.

-- AlterTable
ALTER TABLE `service` ADD COLUMN `spira_project` VARCHAR(16) NULL;

-- CreateTable
CREATE TABLE `gate_ticket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `service` VARCHAR(64) NOT NULL,
    `gate` VARCHAR(128) NOT NULL,
    `step` VARCHAR(128) NULL,
    `issue` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gate_ticket_service_gate_key`(`service`, `gate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `test_set` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `service` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `test_set_service_name_key`(`service`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `test_set_run` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `set_id` INTEGER NOT NULL,
    `trace_id` CHAR(32) NOT NULL,
    `added_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `run` JSON NOT NULL,
    `calls` JSON NOT NULL,

    UNIQUE INDEX `test_set_run_set_id_trace_id_key`(`set_id`, `trace_id`),
    INDEX `test_set_run_set_id_idx`(`set_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The Officina apps' Spira projects, for the rows that already exist; `prisma/seed.ts` sets the same
-- on a fresh database. A row without one offers no "create the ticket".
UPDATE `service` SET `spira_project` = 'OPI' WHERE `name` = 'opifex-front' AND `spira_project` IS NULL;
UPDATE `service` SET `spira_project` = 'VID' WHERE `name` = 'vidar-front' AND `spira_project` IS NULL;
UPDATE `service` SET `spira_project` = 'AUS' WHERE `name` = 'auscult-front' AND `spira_project` IS NULL;
UPDATE `service` SET `spira_project` = 'GRO' WHERE `name` = 'groma-front' AND `spira_project` IS NULL;
UPDATE `service` SET `spira_project` = 'ASP' WHERE `name` = 'auspex-front' AND `spira_project` IS NULL;
