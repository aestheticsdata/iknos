-- The domains a site is served under (IKN-84). The shared nginx access log ends each line on
-- `$host`, and this is what turns that host into a service. Nullable, and NULL on every existing
-- row: a site with its own file keeps `log_glob`, and nothing changes until a row names a host.
ALTER TABLE `service` ADD COLUMN `hosts` VARCHAR(255) NULL;
