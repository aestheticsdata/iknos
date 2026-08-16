# MySQL on ks-b

- **Version: 8.4.5** (`/usr/sbin/mysqld --version`, MySQL Community Server - GPL, Linux x86_64),
  read on 2026-08-16. The laptop runs 8.4.5 too, so local development and production are the
  same engine rather than approximately the same one.
- **Native InnoDB partitioning:** available by construction. Since 8.0, partitioning is built
  into InnoDB and is no longer a plugin, so an empty `SHOW PLUGINS | grep partition` is the
  correct result here and not a missing feature.
- **Consequence:** `log_entry` is partitioned by day and carries no `FULLTEXT` index — InnoDB
  forbids one on a partitioned table. Search is indexed filters over a mandatory time range
  plus `LIKE` on the pruned set. Retention is `DROP PARTITION`, which returns disk to the OS.
  Full reasoning in `docs/superpowers/specs/2026-08-10-iknos-nestjs-api-design.md` §4.2.

## Proven, not assumed

Run on 2026-08-16 against the local 8.4.5 — the same version ks-b runs — in the `iknos`
database:

```sql
CREATE TABLE _pt (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ts DATETIME(3) NOT NULL,
  PRIMARY KEY (id, ts)
) ENGINE=InnoDB
PARTITION BY RANGE (TO_DAYS(ts)) (PARTITION p_future VALUES LESS THAN MAXVALUE);
```

`SHOW CREATE TABLE` came back with the clause intact:

```
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
/*!50100 PARTITION BY RANGE (to_days(`ts`))
(PARTITION p_future VALUES LESS THAN MAXVALUE ENGINE = InnoDB) */
```

Two things that matters proves. Partitioning works on this engine, and an `AUTO_INCREMENT`
column is accepted as the **leading** part of a composite primary key — InnoDB requires the
auto-increment column to lead an index, and MySQL requires every unique key on a partitioned
table to contain the partitioning column. `(id, ts)` is the one shape that satisfies both, and
it is the shape `LogEntry` needs.

The table also inherited `utf8mb4_unicode_ci` from the database default, which is the whole
point of declaring that collation on the database rather than leaving MySQL 8's own default.

Table dropped afterwards.

**Not yet run on ks-b**, because the database there does not exist yet (below) and the
credentials are not mine to handle. Same engine version, so the risk this covers is closed;
re-run it there when the database is created if you want the belt as well as the braces.

## The `iknos` database on ks-b does not exist yet

`IKN-3` assumed a dedicated `iknos` database with its own user was already in place on ks-b.
It is not: `/var/www/iknos` contains only `public_html`, the mock's web root.

The local pair was created on 2026-08-16. The ks-b one is still to do — it is a prerequisite of
the first `migrate deploy`, so it belongs with Task 31 Step 5 rather than here.

Locally — the shadow database is only needed where `prisma migrate dev` runs:

```sql
CREATE DATABASE iknos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE iknos_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'iknos'@'127.0.0.1' IDENTIFIED BY '<passphrase>';
GRANT ALL PRIVILEGES ON iknos.* TO 'iknos'@'127.0.0.1';
GRANT ALL PRIVILEGES ON iknos_shadow.* TO 'iknos'@'127.0.0.1';
FLUSH PRIVILEGES;
```

On ks-b, the first, third and fourth lines only — `migrate deploy` replays existing migrations
and needs no scratch copy.

Two details that are easy to get wrong and both fail confusingly:

- **`@'127.0.0.1'`, not `@'localhost'`.** MySQL treats them as separate accounts: `localhost`
  means the unix socket, `127.0.0.1` means TCP. `DATABASE_URL` points at `127.0.0.1:3306`, so a
  `localhost` grant authenticates an account the connection never reaches.
- **The shadow database is not optional.** `prisma migrate dev` builds a throwaway copy to diff
  the schema against, and creates it itself only if the user holds `CREATE DATABASE` — which
  this one deliberately does not. Same reason trekker has `trekker_shadow`. Point Prisma at it
  with `shadowDatabaseUrl` in `schema.prisma`.

`ALL PRIVILEGES` scoped to the one schema, because Prisma migrations issue DDL and the
partition-maintenance job (Task 20) issues `ALTER TABLE … REORGANIZE PARTITION`. Nothing
outside `iknos.*`.

**`utf8mb4_unicode_ci`, not MySQL 8's own default `utf8mb4_0900_ai_ci`.** Not nostalgia: Prisma's
MySQL connector stamps `COLLATE utf8mb4_unicode_ci` onto every `CREATE TABLE` it generates —
visible in `trekker/nest-api/prisma/migrations/20260809151231_init/migration.sql`. Declaring the
database as `0900_ai_ci` would leave the schema default disagreeing with every table Prisma
creates in it, and the first comparison between a table column and anything inheriting the
database default raises `Illegal mix of collations`. Matching the tool is worth more than the
newer collation algorithm on log text.

The connection string then goes in `.env` as `DATABASE_URL`, which `.gitignore` already
excludes.
