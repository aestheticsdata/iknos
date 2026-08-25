-- IKN-9: grouped errors — the two tables of M3's first wave, additive.
--
-- `issue_event` ends in a hand-written partition clause, same convention as log_entry and the
-- M2 sample tables: Prisma cannot express partitioning and will not round-trip it, so that
-- clause is the part a regenerated migration would silently drop. If
-- `SHOW CREATE TABLE issue_event` ever comes back without it, that is what happened.
--
-- Only `p_future` exists at creation: the table is writable from the first insert, and the
-- sliding daily window is the maintenance pass's job — extended by this ticket to cover
-- issue_event, on the log retention rather than the shorter metric one it would otherwise
-- have inherited.
--
-- `issue` is deliberately NOT partitioned and NOT pruned. It is an identity table: an issue
-- whose occurrences have all aged out still answers "when did this first appear", which is the
-- column the view exists for. It therefore keeps a plain single-column PRIMARY KEY — the
-- composite (id, ts) elsewhere in this schema exists only to satisfy partitioning, and copying
-- it here would be cargo cult.
--
-- `release_tag`, never `release`: RELEASE is reserved in MySQL 8.0 and every hand-written
-- statement in this codebase writes bare, unquoted column names. Prisma backticks its own DDL,
-- so the CREATE would have succeeded and the first raw SELECT would have been the failure.

-- CreateTable
CREATE TABLE `issue` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fingerprint` CHAR(16) NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `type` VARCHAR(255) NULL,
    `message` TEXT NOT NULL,
    `culprit` VARCHAR(255) NULL,
    `level` SMALLINT NOT NULL,
    `level_name` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'unresolved',
    `regression` BOOLEAN NOT NULL DEFAULT false,
    `first_seen` DATETIME(3) NOT NULL,
    `last_seen` DATETIME(3) NOT NULL,
    `event_count` INTEGER NOT NULL DEFAULT 0,
    `first_release` VARCHAR(64) NULL,
    `last_release` VARCHAR(64) NULL,
    `sample` JSON NULL,

    UNIQUE INDEX `issue_fingerprint_key`(`fingerprint`),
    INDEX `issue_service_last_seen_idx`(`service`, `last_seen`),
    INDEX `issue_status_last_seen_idx`(`status`, `last_seen`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `issue_event` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL,
    `issue_id` INTEGER NOT NULL,
    `service` VARCHAR(64) NOT NULL,
    `trace_id` CHAR(32) NULL,
    `release_tag` VARCHAR(64) NULL,
    `message` TEXT NOT NULL,
    `stack` TEXT NULL,
    `attrs` JSON NULL,

    INDEX `issue_event_issue_id_ts_idx`(`issue_id`, `ts`),
    INDEX `issue_event_service_ts_idx`(`service`, `ts`),
    PRIMARY KEY (`id`, `ts`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(`ts`)) (
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
