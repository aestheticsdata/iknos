-- `trace_id` was CHAR(32): sized for a W3C trace id, but the apps write a UUID with its dashes —
-- 36 characters. The writer clamped it to 32 to survive strict mode, so the database held a
-- shortened id while the live stream showed the whole one, and the trace route refused the whole
-- one as malformed. VARCHAR(64) takes a UUID and leaves room for whatever a logger invents next.
--
-- A type change, so MySQL rebuilds both tables (ALGORITHM=COPY) and holds writes for the length of
-- the rebuild. The collector loses nothing to that: it saves its file offsets in the same
-- transaction as the rows, so it waits on the lock and catches up after.
--
-- Rows already stored keep their shortened id. Only new lines carry the full one.
ALTER TABLE `log_entry` MODIFY `trace_id` VARCHAR(64) NULL;

ALTER TABLE `issue_event` MODIFY `trace_id` VARCHAR(64) NULL;
