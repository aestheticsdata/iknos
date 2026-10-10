-- IKN-72 — the IP filter and the hits-per-address grouping.
--
-- `(client_ip, ts)` in the shape of the other four: the partitioning column last, so a range
-- still prunes. It is what the filter token's `client_ip = ?` reads, and what the grouping's
-- `client_ip IS NOT NULL` can read when address-bearing lines are the minority of the range.
--
-- Written by hand rather than generated, for the clause on the end: `log_entry` is the table the
-- collector writes to all day, and `INPLACE, LOCK=NONE` builds the index without blocking those
-- inserts — or refuses outright, which beats taking a lock nobody asked for.
ALTER TABLE `log_entry`
  ADD INDEX `log_entry_client_ip_ts_idx`(`client_ip`, `ts`),
  ALGORITHM=INPLACE, LOCK=NONE;
