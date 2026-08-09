# Iknos M1 — Logs End to End: Implementation Plan

> **SUPERSEDED — DO NOT EXECUTE.** This plan targets the Rust backend, which was dropped on
> 2026-08-10 in favour of NestJS. It is kept only for the task decomposition and the test
> cases, which are language-independent and worth lifting into the replacement plan: the
> rotation decision table (Task 17), the line-framing cases including the split-codepoint one
> (Task 15), the durability pair proving a failed batch advances no offset (Task 18), and the
> partition-planning cases (Task 22). Everything else is Rust-specific.
> The current design is `docs/superpowers/specs/2026-08-10-iknos-nestjs-api-design.md`.

**Goal:** Ship a deployed Iknos that tails every PM2 log file on ks-b into MySQL and serves it back through an authenticated Logs page with search, filters and live tail.

**Architecture:** One Rust binary (`iknos-server`) runs ingestion tasks and the axum HTTP API in a single Tokio runtime, talking to MySQL through sqlx and Redis for sessions. A Next app on the same subdomain holds no database access — its server components fetch the Rust API over localhost, forwarding the session cookie. nginx routes `/api/*` to Rust and everything else to Next.

**Tech Stack:** Rust (Tokio, axum, sqlx/MySQL, tracing), MySQL 8 with daily partitioning, Redis, Next App Router, Tailwind v4, PM2, nginx.

**Spec:** `docs/superpowers/specs/2026-08-09-iknos-rust-api-design.md`

## Global Constraints

- Rust edition 2024, toolchain floor 1.85. Pin with `rust-toolchain.toml`.
- `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --check` must pass before every commit.
- `iknos-ingest` and `iknos-api` may depend on `iknos-core` and `iknos-store`, **never on each other**. They communicate only through channels owned by `iknos-server`.
- Migrations are plain `.sql` under `migrations/`. **No task ever runs a migration from a deploy script** — `sqlx migrate run` is manual over SSH.
- `cargo sqlx prepare` output (`.sqlx/`) is committed so CI compiles without a database.
- Column names: `byte_offset` not `offset`, `app_user` not `user` — both are reserved in MySQL 8.0.
- Every API route except `GET /health` requires a valid session, enforced by a router-level layer, never per-handler.
- Error responses never contain internal detail (SQL text, file paths, hostnames). Detail goes to logs only.
- `GET /api/logs` and `GET /api/logs/stream` reject any request without both `from` and `to`.
- Session cookie is `iknos.sid`: `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, signed. Sliding 2h TTL in Redis under `iknos:sess:`.
- Commits use the repo's configured git identity with no co-author or tool attribution trailers.

## File Structure

```
iknos/
  Cargo.toml                       workspace manifest, shared dependency versions
  rust-toolchain.toml              toolchain floor
  migrations/
    0001_init.sql                  service, app_user, ingest_offset, log_entry
  crates/
    iknos-core/src/
      lib.rs                       re-exports
      config.rs                    Config type, env loading, validation
      error.rs                     AppError + IntoResponse
      log_record.rs                LogRecord — the shape crossing every boundary
      telemetry.rs                 ECS tracing subscriber
      supervisor.rs                spawn_supervised
    iknos-store/src/
      lib.rs                       pool construction
      logs.rs                      log queries, cursor pagination, batch insert
      offsets.rs                   ingest_offset read/write
      users.rs                     app_user lookup and creation
      services.rs                  service registry
      maintenance.rs               partition window and retention
    iknos-ingest/src/
      lib.rs                       run_ingestion entry point
      line_buffer.rs               byte framing, partial-line carry
      parser.rs                    ECS / bare JSON / plain text
      tailer.rs                    stat loop, rotation, offsets
      writer.rs                    batching, transactional commit
    iknos-api/src/
      lib.rs                       router assembly
      auth/
        mod.rs                     session layer, requireauth
        password.rs                argon2id hash and verify
        session.rs                 Redis session store
        csrf.rs                    token mint and constant-time verify
        routes.rs                  login, logout, csrf, me
      logs.rs                      GET /api/logs
      stream.rs                    GET /api/logs/stream
      services.rs                  GET /api/services
      health.rs                    GET /health
    iknos-server/src/
      main.rs                      wiring, channels, CLI subcommands
  web/                             Next app (own pnpm project)
  deploy/
    ecosystem.config.js
    nginx.conf
    deploy.sh
```

---

## Task 1: Workspace skeleton and toolchain

**Files:**
- Create: `Cargo.toml`, `rust-toolchain.toml`, `crates/iknos-core/Cargo.toml`, `crates/iknos-core/src/lib.rs`, `crates/iknos-store/Cargo.toml`, `crates/iknos-store/src/lib.rs`, `crates/iknos-ingest/Cargo.toml`, `crates/iknos-ingest/src/lib.rs`, `crates/iknos-api/Cargo.toml`, `crates/iknos-api/src/lib.rs`, `crates/iknos-server/Cargo.toml`, `crates/iknos-server/src/main.rs`

**Interfaces:**
- Produces: a workspace where `cargo build --workspace` succeeds and every later task has a crate to write into.

- [ ] **Step 1: Create the workspace manifest**

`Cargo.toml`:

```toml
[workspace]
resolver = "3"
members = ["crates/*"]

[workspace.package]
edition = "2024"
rust-version = "1.85"
license = "MIT"

[workspace.dependencies]
anyhow = "1"
thiserror = "2"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
tracing = "0.1"
```

Versions here are floors; run `cargo add` per crate as tasks need them and let Cargo resolve.

- [ ] **Step 2: Pin the toolchain**

`rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.85"
components = ["rustfmt", "clippy"]
```

- [ ] **Step 3: Create the five crates**

Run:

```bash
cargo new --lib crates/iknos-core && cargo new --lib crates/iknos-store && cargo new --lib crates/iknos-ingest && cargo new --lib crates/iknos-api && cargo new --bin crates/iknos-server
```

Then edit each `crates/*/Cargo.toml` to inherit workspace settings — for example `crates/iknos-core/Cargo.toml`:

```toml
[package]
name = "iknos-core"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true

[dependencies]
```

- [ ] **Step 4: Verify the workspace builds**

Run: `cargo build --workspace`
Expected: `Finished dev profile` with five crates compiled, no warnings.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock rust-toolchain.toml crates/
git commit -m "chore: cargo workspace skeleton for iknos"
```

---

## Task 2: Verify MySQL on ks-b supports what the schema needs

**Files:**
- Create: `docs/ks-b-mysql.md`

**Interfaces:**
- Produces: a recorded MySQL version and confirmation that native InnoDB partitioning is available. Task 3 must not be written before this passes.

This is the spec's open item #1. It is a task rather than a footnote because the entire storage design depends on the answer.

- [ ] **Step 1: Check the version and partitioning support**

Run over SSH on ks-b:

```bash
mysql -e "SELECT VERSION(); SHOW PLUGINS;" | grep -Ei 'version|partition'
```

Expected: MySQL 8.0 or later. In 8.0 partitioning is built into InnoDB and does **not** appear as a plugin — an empty grep for `partition` is the correct result on 8.0, not a failure. On 5.7 you would see a `partition` plugin row instead.

- [ ] **Step 2: Prove partitioning works with a throwaway table**

Run over SSH:

```bash
mysql iknos -e "CREATE TABLE _pt (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ts DATETIME(3) NOT NULL, PRIMARY KEY (id, ts)) ENGINE=InnoDB PARTITION BY RANGE (TO_DAYS(ts)) (PARTITION p_future VALUES LESS THAN MAXVALUE); SHOW CREATE TABLE _pt\G DROP TABLE _pt;"
```

Expected: the `SHOW CREATE TABLE` output ends with a `/*!50100 PARTITION BY RANGE ... */` clause. If this errors, stop and report — the schema design in the spec needs revisiting before any code is written.

- [ ] **Step 3: Record the result**

`docs/ks-b-mysql.md`:

```markdown
# MySQL on ks-b

- Version: <paste output of SELECT VERSION()>
- Native InnoDB partitioning: confirmed <date> by creating and dropping a
  RANGE-partitioned table in the `iknos` database.
- Consequence: `log_entry` is partitioned by day and carries no FULLTEXT index.
  See docs/superpowers/specs/2026-08-09-iknos-rust-api-design.md §4.2.
```

- [ ] **Step 4: Commit**

```bash
git add docs/ks-b-mysql.md
git commit -m "docs: confirm MySQL version and partitioning support on ks-b"
```

---

## Task 3: Initial migration

**Files:**
- Create: `migrations/0001_init.sql`, `.env.example`

**Interfaces:**
- Produces: tables `service`, `app_user`, `ingest_offset`, `log_entry`. Every later task reads or writes these.

- [ ] **Step 1: Install sqlx-cli and create the local database**

Run:

```bash
cargo install sqlx-cli --no-default-features --features mysql,rustls
```

Then create a local `iknos` database and a dedicated user with rights limited to it. Record the URL in `.env.example`:

```
DATABASE_URL=mysql://iknos:CHANGE_ME@127.0.0.1:3306/iknos
REDIS_URL=redis://127.0.0.1:6379
IKNOS_PORT=4310
IKNOS_LOG_LEVEL=info
IKNOS_COOKIE_SECRET=CHANGE_ME_64_BYTES_MINIMUM
IKNOS_RETENTION_DAYS=14
IKNOS_PM2_LOG_GLOB=/home/YOUR_USER/.pm2/logs/*.log
```

- [ ] **Step 2: Write the migration**

`migrations/0001_init.sql`:

```sql
CREATE TABLE service (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(64)  NOT NULL,
  pm2_name    VARCHAR(64)  NOT NULL,
  metrics_url VARCHAR(255)     NULL,
  health_url  VARCHAR(255)     NULL,
  log_glob    VARCHAR(512)     NULL,
  enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_name (name)
) ENGINE=InnoDB;

CREATE TABLE app_user (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_email (email)
) ENGINE=InnoDB;

CREATE TABLE ingest_offset (
  file_path   VARCHAR(512)    NOT NULL,
  dev         BIGINT UNSIGNED NOT NULL,
  inode       BIGINT UNSIGNED NOT NULL,
  byte_offset BIGINT UNSIGNED NOT NULL,
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (file_path)
) ENGINE=InnoDB;

CREATE TABLE log_entry (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ts          DATETIME(3)     NOT NULL,
  service     VARCHAR(64)     NOT NULL,
  level       SMALLINT        NOT NULL,
  level_name  VARCHAR(16)     NOT NULL,
  logger      VARCHAR(128)        NULL,
  message     TEXT            NOT NULL,
  trace_id    CHAR(32)            NULL,
  http_method VARCHAR(10)         NULL,
  route       VARCHAR(255)        NULL,
  status_code SMALLINT            NULL,
  duration_ms INT                 NULL,
  client_ip   VARCHAR(45)         NULL,
  user_id     VARCHAR(64)         NULL,
  hostname    VARCHAR(128)        NULL,
  attrs       JSON                NULL,
  PRIMARY KEY (id, ts),
  KEY idx_service_ts (service, ts),
  KEY idx_level_ts   (level, ts),
  KEY idx_trace      (trace_id, ts),
  KEY idx_route_ts   (route, ts)
) ENGINE=InnoDB
PARTITION BY RANGE (TO_DAYS(ts)) (
  PARTITION p_future VALUES LESS THAN MAXVALUE
);

INSERT INTO service (name, pm2_name) VALUES ('pfa-api', 'pfa-nest-api'), ('pfa-front', 'pfa-front');
```

- [ ] **Step 3: Apply it and verify the partitioning survived**

Run:

```bash
sqlx migrate run && mysql iknos -e "SHOW CREATE TABLE log_entry\G"
```

Expected: the output contains `PARTITION BY RANGE (TO_DAYS(ts))` and `PARTITION p_future VALUES LESS THAN MAXVALUE`. If the partition clause is absent the table was silently created unpartitioned — stop and investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add migrations/ .env.example
git commit -m "feat: initial schema with day-partitioned log_entry"
```

---

## Task 4: Database pool

**Files:**
- Create: `crates/iknos-store/src/lib.rs`, `crates/iknos-store/tests/pool.rs`
- Modify: `crates/iknos-store/Cargo.toml`

**Interfaces:**
- Produces: `iknos_store::connect(url: &str, max_conns: u32) -> anyhow::Result<MySqlPool>`. Every store module and both halves of the server take `&MySqlPool`.

- [ ] **Step 1: Add dependencies**

Run:

```bash
cargo add -p iknos-store sqlx --features mysql,runtime-tokio,tls-rustls,chrono,json,macros,migrate --no-default-features && cargo add -p iknos-store anyhow --workspace && cargo add -p iknos-store tokio --workspace --dev
```

- [ ] **Step 2: Write the failing test**

`crates/iknos-store/tests/pool.rs`:

```rust
#[tokio::test]
async fn connects_and_sees_the_partitioned_table() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set to run store tests");
    let pool = iknos_store::connect(&url, 2).await.expect("pool");

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.PARTITIONS \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'log_entry' \
           AND PARTITION_NAME IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .expect("query");

    assert!(count >= 1, "log_entry must be partitioned, found {count} partitions");
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cargo test -p iknos-store`
Expected: FAIL — `cannot find function 'connect' in crate 'iknos_store'`.

- [ ] **Step 4: Implement the pool**

`crates/iknos-store/src/lib.rs`:

```rust
use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use std::time::Duration;

pub async fn connect(url: &str, max_conns: u32) -> anyhow::Result<MySqlPool> {
    let pool = MySqlPoolOptions::new()
        .max_connections(max_conns)
        .acquire_timeout(Duration::from_secs(5))
        .connect(url)
        .await?;
    Ok(pool)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test -p iknos-store`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add crates/iknos-store Cargo.lock
git commit -m "feat(store): mysql connection pool"
```

---

## Task 5: Configuration loading

**Files:**
- Create: `crates/iknos-core/src/config.rs`, `crates/iknos-core/src/lib.rs`
- Modify: `crates/iknos-core/Cargo.toml`

**Interfaces:**
- Produces: `iknos_core::Config` with fields `database_url: String`, `redis_url: String`, `port: u16`, `log_level: String`, `cookie_secret: String`, `retention_days: u32`, `pm2_log_glob: String`, and `Config::from_env() -> Result<Config, ConfigError>`.

- [ ] **Step 1: Write the failing test**

`crates/iknos-core/src/config.rs` (test module at the bottom of the file you are about to create):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn full_env() -> Vec<(String, String)> {
        vec![
            ("DATABASE_URL".into(), "mysql://x/y".into()),
            ("REDIS_URL".into(), "redis://x".into()),
            ("IKNOS_PORT".into(), "4310".into()),
            ("IKNOS_LOG_LEVEL".into(), "info".into()),
            ("IKNOS_COOKIE_SECRET".into(), "k".repeat(64)),
            ("IKNOS_RETENTION_DAYS".into(), "14".into()),
            ("IKNOS_PM2_LOG_GLOB".into(), "/tmp/*.log".into()),
        ]
    }

    #[test]
    fn loads_a_complete_environment() {
        let cfg = Config::from_pairs(full_env()).expect("should load");
        assert_eq!(cfg.port, 4310);
        assert_eq!(cfg.retention_days, 14);
    }

    #[test]
    fn names_the_missing_variable() {
        let env: Vec<_> = full_env().into_iter().filter(|(k, _)| k != "REDIS_URL").collect();
        let err = Config::from_pairs(env).unwrap_err();
        assert!(err.to_string().contains("REDIS_URL"), "got: {err}");
    }

    #[test]
    fn rejects_a_short_cookie_secret() {
        let env: Vec<_> = full_env()
            .into_iter()
            .map(|(k, v)| if k == "IKNOS_COOKIE_SECRET" { (k, "short".into()) } else { (k, v) })
            .collect();
        let err = Config::from_pairs(env).unwrap_err();
        assert!(err.to_string().contains("IKNOS_COOKIE_SECRET"), "got: {err}");
    }

    #[test]
    fn rejects_a_non_numeric_port() {
        let env: Vec<_> = full_env()
            .into_iter()
            .map(|(k, v)| if k == "IKNOS_PORT" { (k, "http".into()) } else { (k, v) })
            .collect();
        assert!(Config::from_pairs(env).is_err());
    }
}
```

`from_pairs` exists so the tests never touch process-global environment state, which would make them order-dependent.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-core`
Expected: FAIL — `cannot find type 'Config' in this scope`.

- [ ] **Step 3: Implement Config**

At the top of `crates/iknos-core/src/config.rs`:

```rust
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub port: u16,
    pub log_level: String,
    pub cookie_secret: String,
    pub retention_days: u32,
    pub pm2_log_glob: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("environment variable {0} is invalid: {1}")]
    Invalid(&'static str, String),
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_pairs(std::env::vars().collect::<Vec<_>>())
    }

    pub fn from_pairs(pairs: Vec<(String, String)>) -> Result<Self, ConfigError> {
        let map: HashMap<String, String> = pairs.into_iter().collect();

        fn get(map: &HashMap<String, String>, key: &'static str) -> Result<String, ConfigError> {
            map.get(key)
                .filter(|v| !v.trim().is_empty())
                .cloned()
                .ok_or(ConfigError::Missing(key))
        }

        let cookie_secret = get(&map, "IKNOS_COOKIE_SECRET")?;
        if cookie_secret.len() < 64 {
            return Err(ConfigError::Invalid(
                "IKNOS_COOKIE_SECRET",
                format!("must be at least 64 bytes, got {}", cookie_secret.len()),
            ));
        }

        let port = get(&map, "IKNOS_PORT")?
            .parse::<u16>()
            .map_err(|e| ConfigError::Invalid("IKNOS_PORT", e.to_string()))?;

        let retention_days = get(&map, "IKNOS_RETENTION_DAYS")?
            .parse::<u32>()
            .map_err(|e| ConfigError::Invalid("IKNOS_RETENTION_DAYS", e.to_string()))?;

        if retention_days == 0 {
            return Err(ConfigError::Invalid(
                "IKNOS_RETENTION_DAYS",
                "must be at least 1".into(),
            ));
        }

        Ok(Config {
            database_url: get(&map, "DATABASE_URL")?,
            redis_url: get(&map, "REDIS_URL")?,
            port,
            log_level: get(&map, "IKNOS_LOG_LEVEL")?,
            cookie_secret,
            retention_days,
            pm2_log_glob: get(&map, "IKNOS_PM2_LOG_GLOB")?,
        })
    }
}
```

Add to `crates/iknos-core/src/lib.rs`:

```rust
pub mod config;
pub use config::{Config, ConfigError};
```

Run `cargo add -p iknos-core thiserror --workspace` first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-core`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/iknos-core Cargo.lock
git commit -m "feat(core): validated configuration loading"
```

---

## Task 6: Application error type

**Files:**
- Create: `crates/iknos-core/src/error.rs`
- Modify: `crates/iknos-core/src/lib.rs`, `crates/iknos-core/Cargo.toml`

**Interfaces:**
- Produces: `iknos_core::AppError` with variants `BadRequest(String)`, `Unauthorized`, `Forbidden`, `NotFound`, `TooManyRequests`, `Internal(anyhow::Error)`, implementing `axum::response::IntoResponse`. Every handler in `iknos-api` returns `Result<T, AppError>`. `From<sqlx::Error>` and `From<anyhow::Error>` map to `Internal`.

- [ ] **Step 1: Write the failing test**

At the bottom of `crates/iknos-core/src/error.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::response::IntoResponse;

    #[tokio::test]
    async fn internal_errors_never_leak_their_detail() {
        let err = AppError::Internal(anyhow::anyhow!("table 'iknos.secret' doesn't exist"));
        let res = err.into_response();
        assert_eq!(res.status(), axum::http::StatusCode::INTERNAL_SERVER_ERROR);

        let body = to_bytes(res.into_body(), 8192).await.unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(!text.contains("secret"), "internal detail leaked: {text}");
        assert!(text.contains("internal error"), "got: {text}");
    }

    #[tokio::test]
    async fn client_errors_keep_their_message() {
        let res = AppError::BadRequest("from and to are required".into()).into_response();
        assert_eq!(res.status(), axum::http::StatusCode::BAD_REQUEST);

        let body = to_bytes(res.into_body(), 8192).await.unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(text.contains("from and to are required"), "got: {text}");
    }

    #[test]
    fn statuses_map_as_expected() {
        assert_eq!(AppError::Unauthorized.status(), axum::http::StatusCode::UNAUTHORIZED);
        assert_eq!(AppError::Forbidden.status(), axum::http::StatusCode::FORBIDDEN);
        assert_eq!(AppError::NotFound.status(), axum::http::StatusCode::NOT_FOUND);
        assert_eq!(
            AppError::TooManyRequests.status(),
            axum::http::StatusCode::TOO_MANY_REQUESTS
        );
    }
}
```

The first test is the one that matters. It is the spec's "error responses never contain internal detail" constraint turned into something that fails loudly if someone later adds `{:?}` to the response body.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-core error`
Expected: FAIL — `cannot find type 'AppError' in this scope`.

- [ ] **Step 3: Implement AppError**

Run `cargo add -p iknos-core axum serde_json --workspace` and `cargo add -p iknos-core anyhow --workspace` first, plus `cargo add -p iknos-core tokio --workspace --dev`.

At the top of `crates/iknos-core/src/error.rs`:

```rust
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("not found")]
    NotFound,
    #[error("too many requests")]
    TooManyRequests,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    pub fn status(&self) -> StatusCode {
        match self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::TooManyRequests => StatusCode::TOO_MANY_REQUESTS,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Internal(e.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();

        // The public message for Internal is deliberately constant. The detail is
        // logged here and nowhere else — this is the only place that decision lives.
        let public = match &self {
            AppError::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                "internal error".to_string()
            }
            other => other.to_string(),
        };

        (status, Json(json!({ "error": public }))).into_response()
    }
}
```

Add `pub mod error; pub use error::AppError;` to `crates/iknos-core/src/lib.rs`. Add `sqlx` to `iknos-core` with the same feature set used in Task 4.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-core`
Expected: PASS, 7 tests (4 config + 3 error).

- [ ] **Step 5: Commit**

```bash
git add crates/iknos-core Cargo.lock
git commit -m "feat(core): application error type with leak-proof responses"
```

---

## Task 7: ECS tracing subscriber

**Files:**
- Create: `crates/iknos-core/src/telemetry.rs`
- Modify: `crates/iknos-core/src/lib.rs`, `crates/iknos-core/Cargo.toml`

**Interfaces:**
- Produces: `iknos_core::telemetry::init(log_level: &str) -> anyhow::Result<()>`, and the constant `iknos_core::telemetry::INGEST_SKIP_MARKER` (`"IKNOS_SELF_ERR"`). Task 13's parser must skip any line containing the marker; Task 15's writer prints it on database failure.

Iknos emits the same ECS shape it ingests, so it monitors itself through its own pipeline.

- [ ] **Step 1: Write the failing test**

At the bottom of `crates/iknos-core/src/telemetry.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn renders_an_ecs_shaped_line() {
        let line = render_ecs_line(
            "2026-08-09T12:00:00.123Z",
            "info",
            "iknos_ingest::tailer",
            "resumed at offset 4096",
        );
        let v: Value = serde_json::from_str(&line).expect("valid json");

        assert_eq!(v["@timestamp"], "2026-08-09T12:00:00.123Z");
        assert_eq!(v["log.level"], "info");
        assert_eq!(v["log.logger"], "iknos_ingest::tailer");
        assert_eq!(v["message"], "resumed at offset 4096");
        assert_eq!(v["service.name"], "iknos");
        assert_eq!(v["ecs.version"], "8.11.0");
    }

    #[test]
    fn escapes_control_characters_so_one_event_is_one_line() {
        let line = render_ecs_line("2026-08-09T12:00:00.000Z", "error", "t", "a\nb\tc");
        assert_eq!(line.lines().count(), 1, "an event must never span two lines");
        let v: Value = serde_json::from_str(&line).expect("valid json");
        assert_eq!(v["message"], "a\nb\tc");
    }
}
```

The second test is not decoration. A multi-line log event would be re-ingested as several rows, one of which is invalid JSON — the failure mode is silent and confusing.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-core telemetry`
Expected: FAIL — `cannot find function 'render_ecs_line'`.

- [ ] **Step 3: Implement the renderer and the subscriber**

Run:

```bash
cargo add -p iknos-core tracing --workspace && cargo add -p iknos-core tracing-subscriber --features env-filter,fmt && cargo add -p iknos-core chrono --workspace
```

At the top of `crates/iknos-core/src/telemetry.rs`:

```rust
use std::fmt;
use tracing::{Event, Subscriber};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields, FormattedFields};
use tracing_subscriber::registry::LookupSpan;

/// Printed on stderr when the database write path itself fails. The ingest
/// parser skips any line containing it, so a database outage cannot become an
/// infinite loop of failures logging failures.
pub const INGEST_SKIP_MARKER: &str = "IKNOS_SELF_ERR";

pub fn render_ecs_line(ts: &str, level: &str, logger: &str, message: &str) -> String {
    let obj = serde_json::json!({
        "@timestamp": ts,
        "log.level": level,
        "log.logger": logger,
        "message": message,
        "service.name": "iknos",
        "ecs.version": "8.11.0",
    });
    // serde_json::to_string escapes control characters, so the result is always
    // exactly one line.
    obj.to_string()
}

struct EcsFormat;

impl<S, N> FormatEvent<S, N> for EcsFormat
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let meta = event.metadata();

        // Render the event's fields through the normal field formatter, then use
        // the result as the message. `message` is just another field to tracing.
        let mut fields = String::new();
        ctx.field_format()
            .format_fields(Writer::new(&mut fields), event)?;

        // Prepend any span context so a line keeps its scope.
        let mut scope = String::new();
        if let Some(span) = ctx.lookup_current() {
            for s in span.scope().from_root() {
                if let Some(f) = s.extensions().get::<FormattedFields<N>>() {
                    if !f.is_empty() {
                        scope.push_str(f);
                        scope.push(' ');
                    }
                }
            }
        }
        let message = format!("{scope}{fields}");

        let ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let line = render_ecs_line(
            &ts,
            &meta.level().to_string().to_lowercase(),
            meta.target(),
            message.trim(),
        );
        writeln!(writer, "{line}")
    }
}

pub fn init(log_level: &str) -> anyhow::Result<()> {
    let filter = EnvFilter::try_new(log_level)?;
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .event_format(EcsFormat)
        .with_writer(std::io::stdout)
        .try_init()
        .map_err(|e| anyhow::anyhow!("failed to install tracing subscriber: {e}"))?;
    Ok(())
}
```

Add `pub mod telemetry;` to `crates/iknos-core/src/lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-core`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/iknos-core Cargo.lock
git commit -m "feat(core): ECS-shaped tracing output"
```

---

## Task 8: Task supervisor

**Files:**
- Create: `crates/iknos-core/src/supervisor.rs`
- Modify: `crates/iknos-core/src/lib.rs`

**Interfaces:**
- Produces: `iknos_core::supervisor::spawn_supervised<F, Fut>(name: &'static str, shutdown: CancellationToken, factory: F) -> JoinHandle<()>` where `F: Fn() -> Fut + Send + 'static` and `Fut: Future<Output = anyhow::Result<()>> + Send`. Tasks 16 and 19 spawn their loops through this.

A tailer that panics must not take the API down with it.

- [ ] **Step 1: Write the failing test**

At the bottom of `crates/iknos-core/src/supervisor.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[tokio::test]
    async fn restarts_a_panicking_task_until_shutdown() {
        let attempts = Arc::new(AtomicU32::new(0));
        let shutdown = CancellationToken::new();

        let a = attempts.clone();
        let sd = shutdown.clone();
        let handle = spawn_supervised("flaky", shutdown.clone(), move || {
            let a = a.clone();
            let sd = sd.clone();
            async move {
                let n = a.fetch_add(1, Ordering::SeqCst);
                if n < 2 {
                    panic!("boom");
                }
                sd.cancel();
                Ok(())
            }
        });

        handle.await.expect("supervisor should not itself panic");
        assert!(
            attempts.load(Ordering::SeqCst) >= 3,
            "expected at least 3 attempts, got {}",
            attempts.load(Ordering::SeqCst)
        );
    }

    #[tokio::test]
    async fn stops_promptly_when_cancelled() {
        let shutdown = CancellationToken::new();
        let handle = spawn_supervised("idle", shutdown.clone(), || async {
            std::future::pending::<()>().await;
            Ok(())
        });
        shutdown.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(2), handle)
            .await
            .expect("supervisor should exit on cancel")
            .expect("no panic");
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-core supervisor`
Expected: FAIL — `cannot find function 'spawn_supervised'`.

- [ ] **Step 3: Implement the supervisor**

Run `cargo add -p iknos-core tokio-util --features rt`.

At the top of `crates/iknos-core/src/supervisor.rs`:

```rust
use std::future::Future;
use std::time::Duration;
use tokio::task::JoinHandle;
pub use tokio_util::sync::CancellationToken;

const BACKOFF_START: Duration = Duration::from_millis(200);
const BACKOFF_MAX: Duration = Duration::from_secs(30);

pub fn spawn_supervised<F, Fut>(
    name: &'static str,
    shutdown: CancellationToken,
    factory: F,
) -> JoinHandle<()>
where
    F: Fn() -> Fut + Send + 'static,
    Fut: Future<Output = anyhow::Result<()>> + Send + 'static,
{
    tokio::spawn(async move {
        let mut backoff = BACKOFF_START;

        loop {
            if shutdown.is_cancelled() {
                tracing::info!(task = name, "stopping");
                return;
            }

            // AssertUnwindSafe is sound here: on panic we drop the future's state
            // entirely and build a fresh one from the factory.
            let attempt = std::panic::AssertUnwindSafe(factory());
            let result = futures::FutureExt::catch_unwind(attempt).await;

            match result {
                Ok(Ok(())) => {
                    tracing::info!(task = name, "finished");
                    return;
                }
                Ok(Err(e)) => tracing::error!(task = name, error = ?e, "task failed, restarting"),
                Err(_) => tracing::error!(task = name, "task panicked, restarting"),
            }

            tokio::select! {
                _ = shutdown.cancelled() => return,
                _ = tokio::time::sleep(backoff) => {}
            }
            backoff = (backoff * 2).min(BACKOFF_MAX);
        }
    })
}
```

Run `cargo add -p iknos-core futures`. Add `pub mod supervisor;` to `crates/iknos-core/src/lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-core`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/iknos-core Cargo.lock
git commit -m "feat(core): supervised task spawning with backoff"
```

---

## Task 9: HTTP server, health check and graceful shutdown

**Files:**
- Create: `crates/iknos-api/src/lib.rs`, `crates/iknos-api/src/health.rs`, `crates/iknos-api/tests/health.rs`
- Modify: `crates/iknos-server/src/main.rs`, `crates/iknos-api/Cargo.toml`, `crates/iknos-server/Cargo.toml`

**Interfaces:**
- Produces: `iknos_api::AppState { pool: MySqlPool, config: Arc<Config> }` and `iknos_api::router(state: AppState) -> axum::Router`. Tasks 11, 17, 18 and 20 add routes to this router; Tasks 11 and 12 add fields to `AppState`.

- [ ] **Step 1: Write the failing test**

`crates/iknos-api/tests/health.rs`:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

#[tokio::test]
async fn health_is_public_and_reveals_nothing() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = iknos_store::connect(&url, 2).await.unwrap();
    let state = iknos_api::test_state(pool);

    let res = iknos_api::router(state)
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);

    let body = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert_eq!(text, r#"{"status":"ok"}"#);
    assert!(!text.contains("version"), "health must not disclose a version");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-api`
Expected: FAIL — `cannot find function 'router' in crate 'iknos_api'`.

- [ ] **Step 3: Implement the router and health handler**

Run:

```bash
cargo add -p iknos-api axum tokio serde serde_json --workspace && cargo add -p iknos-api iknos-core iknos-store --path crates/iknos-core --path crates/iknos-store && cargo add -p iknos-api sqlx --features mysql,runtime-tokio,tls-rustls,chrono,json,macros --no-default-features && cargo add -p iknos-api tower --dev && cargo add -p iknos-api tower-http --features trace
```

(If `cargo add` rejects two `--path` flags in one invocation, add the two path dependencies in separate commands.)

`crates/iknos-api/src/health.rs`:

```rust
use axum::Json;
use serde_json::{Value, json};

/// Liveness only. No version, no dependency status, no hostname — this is the
/// one route reachable without a session.
pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
```

`crates/iknos-api/src/lib.rs`:

```rust
use axum::Router;
use axum::routing::get;
use iknos_core::Config;
use sqlx::MySqlPool;
use std::sync::Arc;

pub mod health;

#[derive(Clone)]
pub struct AppState {
    pub pool: MySqlPool,
    pub config: Arc<Config>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health::health))
        .with_state(state)
}

/// Builds a state with placeholder configuration, for tests that only exercise
/// routes which never read config.
pub fn test_state(pool: MySqlPool) -> AppState {
    AppState {
        pool,
        config: Arc::new(Config {
            database_url: String::new(),
            redis_url: String::new(),
            port: 0,
            log_level: "info".into(),
            cookie_secret: "k".repeat(64),
            retention_days: 14,
            pm2_log_glob: "/tmp/*.log".into(),
        }),
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p iknos-api`
Expected: PASS, 1 test.

- [ ] **Step 5: Wire up the binary with graceful shutdown**

`crates/iknos-server/src/main.rs`:

```rust
use iknos_core::{Config, supervisor::CancellationToken, telemetry};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    telemetry::init(&config.log_level)?;

    let pool = iknos_store::connect(&config.database_url, 10).await?;
    let shutdown = CancellationToken::new();

    let state = iknos_api::AppState {
        pool: pool.clone(),
        config: Arc::new(config.clone()),
    };

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", config.port)).await?;
    tracing::info!(port = config.port, "listening");

    let sd = shutdown.clone();
    axum::serve(listener, iknos_api::router(state))
        .with_graceful_shutdown(async move {
            wait_for_signal().await;
            tracing::info!("shutdown signal received, draining");
            sd.cancel();
        })
        .await?;

    pool.close().await;
    tracing::info!("stopped");
    Ok(())
}

async fn wait_for_signal() {
    use tokio::signal::unix::{SignalKind, signal};
    let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
    let mut int = signal(SignalKind::interrupt()).expect("SIGINT handler");
    tokio::select! {
        _ = term.recv() => {}
        _ = int.recv() => {}
    }
}
```

Bind to `127.0.0.1`, never `0.0.0.0` — nginx is the only thing that should reach this port.

Run `cargo add -p iknos-server iknos-core iknos-api iknos-store --path ...` plus `tokio`, `anyhow`, `tracing`.

- [ ] **Step 6: Verify it runs and stops cleanly**

Run:

```bash
cargo run -p iknos-server &
sleep 3 && curl -s localhost:4310/health && kill -TERM %1 && wait
```

Expected: `{"status":"ok"}`, then a `stopped` log line, exit code 0. The first output line should be ECS JSON containing `"log.level":"info"`.

- [ ] **Step 7: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(api): http server with health check and graceful shutdown"
```

---

## Task 10: Password hashing and the user CLI

**Files:**
- Create: `crates/iknos-api/src/auth/mod.rs`, `crates/iknos-api/src/auth/password.rs`, `crates/iknos-store/src/users.rs`
- Modify: `crates/iknos-api/src/lib.rs`, `crates/iknos-store/src/lib.rs`, `crates/iknos-server/src/main.rs`

**Interfaces:**
- Produces: `iknos_api::auth::password::{hash, verify}` — `hash(plain: &str) -> anyhow::Result<String>` and `verify(plain: &str, phc: &str) -> bool`. Also `iknos_store::users::{find_by_email, create}` where `find_by_email(pool, email) -> sqlx::Result<Option<User>>` and `User { id: u32, email: String, password_hash: String }`. Task 12 consumes both.

- [ ] **Step 1: Write the failing test**

At the bottom of `crates/iknos-api/src/auth/password.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let phc = hash("correct horse battery staple").unwrap();
        assert!(verify("correct horse battery staple", &phc));
    }

    #[test]
    fn rejects_the_wrong_password() {
        let phc = hash("correct horse battery staple").unwrap();
        assert!(!verify("Correct horse battery staple", &phc));
        assert!(!verify("", &phc));
    }

    #[test]
    fn never_stores_the_plaintext() {
        let phc = hash("hunter2").unwrap();
        assert!(!phc.contains("hunter2"));
        assert!(phc.starts_with("$argon2id$"), "got: {phc}");
    }

    #[test]
    fn salts_every_hash_separately() {
        assert_ne!(hash("same").unwrap(), hash("same").unwrap());
    }

    #[test]
    fn a_malformed_stored_hash_is_a_rejection_not_a_panic() {
        assert!(!verify("anything", "not-a-phc-string"));
    }
}
```

The last test matters: a corrupted row must fail the login, not crash the process.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-api password`
Expected: FAIL — `cannot find function 'hash'`.

- [ ] **Step 3: Implement hashing**

Run `cargo add -p iknos-api argon2 --features std` and `cargo add -p iknos-api rand_core --features os_rng`.

At the top of `crates/iknos-api/src/auth/password.rs`:

```rust
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, password_hash::rand_core::OsRng};

/// Returns a PHC string: algorithm, parameters and salt are embedded, so the
/// cost can be raised later without breaking existing hashes.
pub fn hash(plain: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let phc = Argon2::default()
        .hash_password(plain.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("failed to hash password: {e}"))?
        .to_string();
    Ok(phc)
}

/// Any failure — malformed stored hash included — is a rejection.
pub fn verify(plain: &str, phc: &str) -> bool {
    match PasswordHash::new(phc) {
        Ok(parsed) => Argon2::default()
            .verify_password(plain.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}
```

`crates/iknos-api/src/auth/mod.rs`:

```rust
pub mod password;
```

Add `pub mod auth;` to `crates/iknos-api/src/lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-api password`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the user store**

`crates/iknos-store/src/users.rs`:

```rust
use sqlx::MySqlPool;

#[derive(Debug, Clone)]
pub struct User {
    pub id: u32,
    pub email: String,
    pub password_hash: String,
}

pub async fn find_by_email(pool: &MySqlPool, email: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as!(
        User,
        "SELECT id AS `id: u32`, email, password_hash FROM app_user WHERE email = ?",
        email
    )
    .fetch_optional(pool)
    .await
}

pub async fn create(pool: &MySqlPool, email: &str, password_hash: &str) -> sqlx::Result<u32> {
    let res = sqlx::query!(
        "INSERT INTO app_user (email, password_hash) VALUES (?, ?)",
        email,
        password_hash
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_id() as u32)
}
```

Add `pub mod users;` to `crates/iknos-store/src/lib.rs`.

- [ ] **Step 6: Add the CLI subcommand**

Run `cargo add -p iknos-server clap --features derive` and `cargo add -p iknos-server rpassword`.

Insert into `crates/iknos-server/src/main.rs`, replacing the body of `main`:

```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "iknos-server")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Create a login account. There is no public registration.
    User {
        #[command(subcommand)]
        action: UserAction,
    },
}

#[derive(Subcommand)]
enum UserAction {
    Create { email: String },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let config = Config::from_env()?;
    telemetry::init(&config.log_level)?;
    let pool = iknos_store::connect(&config.database_url, 10).await?;

    match cli.command {
        Some(Command::User { action: UserAction::Create { email } }) => {
            let plain = rpassword::prompt_password("password: ")?;
            if plain.len() < 12 {
                anyhow::bail!("password must be at least 12 characters");
            }
            let confirm = rpassword::prompt_password("confirm: ")?;
            if plain != confirm {
                anyhow::bail!("passwords do not match");
            }
            let phc = iknos_api::auth::password::hash(&plain)?;
            let id = iknos_store::users::create(&pool, &email, &phc).await?;
            println!("created user {id} <{email}>");
            pool.close().await;
            Ok(())
        }
        None => serve(config, pool).await,
    }
}
```

Move the listener and `axum::serve` block from Task 9 into `async fn serve(config: Config, pool: sqlx::MySqlPool) -> anyhow::Result<()>`.

- [ ] **Step 7: Verify the CLI creates a usable account**

Run:

```bash
cargo run -p iknos-server -- user create me@example.com
mysql iknos -e "SELECT id, email, LEFT(password_hash, 10) FROM app_user"
```

Expected: `created user 1 <me@example.com>`, and the stored hash begins `$argon2id$`. Re-running with the same email must fail on the unique index rather than create a duplicate.

- [ ] **Step 8: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(auth): argon2id password hashing and user creation CLI"
```

---

## Task 11: Redis session store

**Files:**
- Create: `crates/iknos-api/src/auth/session.rs`, `crates/iknos-api/tests/session.rs`
- Modify: `crates/iknos-api/src/auth/mod.rs`, `crates/iknos-api/src/lib.rs`

**Interfaces:**
- Produces: `SessionStore::new(redis_url) -> anyhow::Result<SessionStore>` (cloneable) with `create(user_id: u32) -> Result<(String, Session)>` returning `(sid, session)`, `get(sid: &str) -> Result<Option<Session>>` (slides the TTL), `delete(sid: &str) -> Result<()>`, `delete_for_user(user_id: u32) -> Result<()>`, and `Session { user_id: u32, csrf_token: String }`. `AppState` gains a `sessions: SessionStore` field. Task 12 consumes all of it.

- [ ] **Step 1: Write the failing test**

`crates/iknos-api/tests/session.rs`:

```rust
use iknos_api::auth::session::SessionStore;

async fn store() -> SessionStore {
    let url = std::env::var("REDIS_URL").expect("REDIS_URL must be set to run session tests");
    SessionStore::new(&url).await.expect("store")
}

#[tokio::test]
async fn creates_and_reads_back_a_session() {
    let s = store().await;
    let (sid, created) = s.create(42).await.unwrap();

    let found = s.get(&sid).await.unwrap().expect("session should exist");
    assert_eq!(found.user_id, 42);
    assert_eq!(found.csrf_token, created.csrf_token);
    assert_eq!(created.csrf_token.len(), 43, "32 random bytes, base64url unpadded");

    s.delete(&sid).await.unwrap();
}

#[tokio::test]
async fn deleting_makes_it_unreadable() {
    let s = store().await;
    let (sid, _) = s.create(7).await.unwrap();
    s.delete(&sid).await.unwrap();
    assert!(s.get(&sid).await.unwrap().is_none());
}

#[tokio::test]
async fn an_unknown_sid_is_none_not_an_error() {
    let s = store().await;
    assert!(s.get("definitely-not-a-session").await.unwrap().is_none());
}

#[tokio::test]
async fn a_new_login_invalidates_the_previous_session() {
    let s = store().await;
    let (first, _) = s.create(99).await.unwrap();

    s.delete_for_user(99).await.unwrap();
    let (second, _) = s.create(99).await.unwrap();

    assert!(s.get(&first).await.unwrap().is_none(), "old session must be gone");
    assert!(s.get(&second).await.unwrap().is_some());

    s.delete(&second).await.unwrap();
}

#[tokio::test]
async fn session_ids_are_unpredictable() {
    let s = store().await;
    let (a, _) = s.create(1).await.unwrap();
    let (b, _) = s.create(1).await.unwrap();
    assert_ne!(a, b);
    assert_eq!(a.len(), 43);
    s.delete(&a).await.unwrap();
    s.delete(&b).await.unwrap();
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-api --test session`
Expected: FAIL — `unresolved import iknos_api::auth::session`.

- [ ] **Step 3: Implement the store**

Run:

```bash
cargo add -p iknos-api redis --features tokio-comp,connection-manager && cargo add -p iknos-api base64 rand
```

`crates/iknos-api/src/auth/session.rs`:

```rust
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::RngCore;
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};

const TTL_SECONDS: u64 = 2 * 60 * 60;
const SESSION_PREFIX: &str = "iknos:sess:";
const USER_PREFIX: &str = "iknos:user:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub user_id: u32,
    pub csrf_token: String,
}

#[derive(Clone)]
pub struct SessionStore {
    conn: ConnectionManager,
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

impl SessionStore {
    pub async fn new(redis_url: &str) -> anyhow::Result<Self> {
        let client = redis::Client::open(redis_url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn })
    }

    pub async fn create(&self, user_id: u32) -> anyhow::Result<(String, Session)> {
        let sid = random_token();
        let session = Session { user_id, csrf_token: random_token() };
        let payload = serde_json::to_string(&session)?;

        let mut conn = self.conn.clone();
        let _: () = conn
            .set_ex(format!("{SESSION_PREFIX}{sid}"), payload, TTL_SECONDS)
            .await?;
        // Remembering the current sid per user is what makes one-session-per-user
        // possible without scanning the keyspace.
        let _: () = conn
            .set_ex(format!("{USER_PREFIX}{user_id}:sid"), sid.clone(), TTL_SECONDS)
            .await?;

        Ok((sid, session))
    }

    /// Reads the session and slides its TTL. Returns None for anything unknown
    /// or expired — never an error, so a bad cookie is a logout, not a 500.
    pub async fn get(&self, sid: &str) -> anyhow::Result<Option<Session>> {
        let mut conn = self.conn.clone();
        let key = format!("{SESSION_PREFIX}{sid}");

        let payload: Option<String> = conn.get(&key).await?;
        let Some(payload) = payload else { return Ok(None) };

        let Ok(session) = serde_json::from_str::<Session>(&payload) else {
            let _: () = conn.del(&key).await?;
            return Ok(None);
        };

        let _: () = conn.expire(&key, TTL_SECONDS as i64).await?;
        let _: () = conn
            .expire(format!("{USER_PREFIX}{}:sid", session.user_id), TTL_SECONDS as i64)
            .await?;

        Ok(Some(session))
    }

    pub async fn delete(&self, sid: &str) -> anyhow::Result<()> {
        let mut conn = self.conn.clone();
        if let Some(session) = self.get(sid).await? {
            let _: () = conn.del(format!("{USER_PREFIX}{}:sid", session.user_id)).await?;
        }
        let _: () = conn.del(format!("{SESSION_PREFIX}{sid}")).await?;
        Ok(())
    }

    pub async fn delete_for_user(&self, user_id: u32) -> anyhow::Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("{USER_PREFIX}{user_id}:sid");
        let existing: Option<String> = conn.get(&key).await?;
        if let Some(sid) = existing {
            let _: () = conn.del(format!("{SESSION_PREFIX}{sid}")).await?;
        }
        let _: () = conn.del(&key).await?;
        Ok(())
    }
}
```

Add `pub mod session;` to `crates/iknos-api/src/auth/mod.rs`.

- [ ] **Step 4: Add the store to AppState**

In `crates/iknos-api/src/lib.rs`, add `pub sessions: auth::session::SessionStore` to `AppState`, and construct it in `test_state` from `REDIS_URL`:

```rust
pub async fn test_state(pool: MySqlPool) -> AppState {
    let redis_url = std::env::var("REDIS_URL").expect("REDIS_URL");
    AppState {
        pool,
        sessions: auth::session::SessionStore::new(&redis_url).await.expect("redis"),
        config: Arc::new(Config { /* as before */ }),
    }
}
```

`test_state` becomes `async`; update the call in `crates/iknos-api/tests/health.rs` to `iknos_api::test_state(pool).await`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p iknos-api`
Expected: PASS — 5 session tests, 5 password tests, 1 health test.

- [ ] **Step 6: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(auth): redis-backed sessions with sliding ttl"
```

---

## Task 12: CSRF verification and the session layer

**Files:**
- Create: `crates/iknos-api/src/auth/csrf.rs`, `crates/iknos-api/src/auth/layer.rs`
- Modify: `crates/iknos-api/src/auth/mod.rs`, `crates/iknos-api/src/lib.rs`

**Interfaces:**
- Produces: `auth::csrf::verify(expected: &str, provided: &str) -> bool` (constant time), `auth::layer::require_session` (an axum middleware function), and the extractor `auth::layer::CurrentSession(pub Session)`. Task 13 mounts the layer; Tasks 17, 18 and 20 extract `CurrentSession`.

- [ ] **Step 1: Write the failing CSRF test**

At the bottom of `crates/iknos-api/src/auth/csrf.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_matching_token() {
        assert!(verify("abc123", "abc123"));
    }

    #[test]
    fn rejects_a_different_token() {
        assert!(!verify("abc123", "abc124"));
    }

    #[test]
    fn rejects_a_prefix_and_an_empty_token() {
        assert!(!verify("abc123", "abc"));
        assert!(!verify("abc123", ""));
        assert!(!verify("", "abc123"));
    }

    #[test]
    fn two_empty_tokens_do_not_authorise_anything() {
        // A session with no token must never let a tokenless request through.
        assert!(!verify("", ""));
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-api csrf`
Expected: FAIL — `cannot find function 'verify'`.

- [ ] **Step 3: Implement constant-time verification**

Run `cargo add -p iknos-api subtle`.

At the top of `crates/iknos-api/src/auth/csrf.rs`:

```rust
use subtle::ConstantTimeEq;

/// Constant-time comparison so a timing signal cannot be used to guess the
/// token byte by byte. Empty tokens never match, including against each other.
pub fn verify(expected: &str, provided: &str) -> bool {
    if expected.is_empty() || provided.is_empty() {
        return false;
    }
    if expected.len() != provided.len() {
        return false;
    }
    expected.as_bytes().ct_eq(provided.as_bytes()).into()
}
```

The early length return is not a leak worth worrying about — the token length is fixed and public. What matters is that equal-length candidates take the same time.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-api csrf`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement the session layer**

Run `cargo add -p iknos-api axum-extra --features cookie-signed`.

`crates/iknos-api/src/auth/layer.rs`:

```rust
use axum::extract::{FromRequestParts, Request, State};
use axum::http::{Method, StatusCode, request::Parts};
use axum::middleware::Next;
use axum::response::Response;
use axum_extra::extract::cookie::SignedCookieJar;
use iknos_core::AppError;

use super::session::Session;
use crate::AppState;

pub const COOKIE_NAME: &str = "iknos.sid";
pub const CSRF_HEADER: &str = "x-csrf-token";

/// Router-level guard. Mounted once, so a route added later cannot forget it.
pub async fn require_session(
    State(state): State<AppState>,
    jar: SignedCookieJar,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let sid = jar
        .get(COOKIE_NAME)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    let session = state
        .sessions
        .get(&sid)
        .await
        .map_err(AppError::Internal)?
        .ok_or(AppError::Unauthorized)?;

    // CSRF applies to every unsafe verb, not just POST.
    let is_safe = matches!(req.method(), &Method::GET | &Method::HEAD | &Method::OPTIONS);
    if !is_safe {
        let provided = req
            .headers()
            .get(CSRF_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !super::csrf::verify(&session.csrf_token, provided) {
            return Err(AppError::Forbidden);
        }
    }

    req.extensions_mut().insert(session);
    Ok(next.run(req).await)
}

/// Extractor for handlers behind `require_session`.
#[derive(Clone)]
pub struct CurrentSession(pub Session);

impl<S: Send + Sync> FromRequestParts<S> for CurrentSession {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<Session>()
            .cloned()
            .map(CurrentSession)
            .ok_or((
                StatusCode::INTERNAL_SERVER_ERROR,
                "handler used CurrentSession outside the session layer",
            ))
    }
}
```

Add `pub mod csrf; pub mod layer;` to `crates/iknos-api/src/auth/mod.rs`.

- [ ] **Step 6: Make signed cookies work**

`SignedCookieJar` needs a `Key` reachable from state. In `crates/iknos-api/src/lib.rs`:

```rust
use axum_extra::extract::cookie::Key;

// inside AppState
pub cookie_key: Key,

impl axum::extract::FromRef<AppState> for Key {
    fn from_ref(state: &AppState) -> Self {
        state.cookie_key.clone()
    }
}
```

Build it in `main.rs` with `Key::from(config.cookie_secret.as_bytes())` — this is why the config requires at least 64 bytes.

- [ ] **Step 7: Verify the workspace still compiles**

Run: `cargo test -p iknos-api`
Expected: PASS, existing tests unaffected.

- [ ] **Step 8: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(auth): session layer with constant-time csrf verification"
```

---

## Task 13: Auth routes

**Files:**
- Create: `crates/iknos-api/src/auth/routes.rs`, `crates/iknos-api/tests/auth.rs`
- Modify: `crates/iknos-api/src/lib.rs`, `crates/iknos-api/src/auth/mod.rs`

**Interfaces:**
- Produces: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/csrf`, `GET /api/me`, and a `router` that splits public from protected routes. Every later route is added to the protected half.

`POST /api/auth/login` is public and does **not** require a CSRF token — there is no session to mint one from yet. `SameSite=Lax` is what protects it from cross-site submission. Everything else lives behind the layer.

- [ ] **Step 1: Write the failing test**

`crates/iknos-api/tests/auth.rs`:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use tower::ServiceExt;

async fn app() -> axum::Router {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = iknos_store::connect(&url, 4).await.unwrap();
    iknos_api::router(iknos_api::test_state(pool).await)
}

async fn get(app: axum::Router, uri: &str, cookie: Option<&str>) -> (StatusCode, String) {
    let mut req = Request::builder().uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let res = app.oneshot(req.body(Body::empty()).unwrap()).await.unwrap();
    let status = res.status();
    let body = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

#[tokio::test]
async fn protected_routes_are_401_without_a_session() {
    for uri in ["/api/me", "/api/csrf", "/api/services", "/api/logs"] {
        let (status, body) = get(app().await, uri, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri} returned {status}: {body}");
    }
}

#[tokio::test]
async fn login_rejects_bad_credentials_without_saying_which_part_was_wrong() {
    let res = app()
        .await
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"email":"nobody@example.com","password":"wrong-password"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(!text.contains("email"), "must not reveal whether the account exists: {text}");
}

#[tokio::test]
async fn login_sets_a_hardened_cookie() {
    // Requires a seeded account; see Step 4.
    let res = app()
        .await
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"email":"test@iknos.local","password":"test-password-1234"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let cookie = res
        .headers()
        .get(header::SET_COOKIE)
        .expect("Set-Cookie")
        .to_str()
        .unwrap()
        .to_string();

    assert!(cookie.starts_with("iknos.sid="));
    assert!(cookie.contains("HttpOnly"), "got: {cookie}");
    assert!(cookie.contains("SameSite=Lax"), "got: {cookie}");
    assert!(cookie.contains("Path=/"), "got: {cookie}");
}

#[tokio::test]
async fn a_mutation_without_a_csrf_token_is_403_not_401() {
    let app = app().await;
    let login = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"email":"test@iknos.local","password":"test-password-1234"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let cookie = login.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap();
    let cookie = cookie.split(';').next().unwrap().to_string();

    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        res.status(),
        StatusCode::FORBIDDEN,
        "a valid session with no CSRF token must be 403, distinguishing it from no session at all"
    );
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-api --test auth`
Expected: FAIL — routes return 404, since only `/health` is mounted.

- [ ] **Step 3: Implement the routes**

`crates/iknos-api/src/auth/routes.rs`:

```rust
use axum::extract::State;
use axum::{Json, http::StatusCode, response::IntoResponse};
use axum_extra::extract::cookie::{Cookie, SameSite, SignedCookieJar};
use iknos_core::AppError;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::layer::{COOKIE_NAME, CurrentSession};
use crate::AppState;

#[derive(Deserialize)]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct MeResponse {
    pub user_id: u32,
}

pub async fn login(
    State(state): State<AppState>,
    jar: SignedCookieJar,
    Json(body): Json<LoginBody>,
) -> Result<impl IntoResponse, AppError> {
    let user = iknos_store::users::find_by_email(&state.pool, &body.email).await?;

    // Verify against a dummy hash when the account is missing, so a nonexistent
    // account and a wrong password take the same time and return the same body.
    let ok = match &user {
        Some(u) => super::password::verify(&body.password, &u.password_hash),
        None => {
            let _ = super::password::verify(&body.password, DUMMY_HASH);
            false
        }
    };

    let Some(user) = user.filter(|_| ok) else {
        return Err(AppError::Unauthorized);
    };

    // One active session per user.
    state.sessions.delete_for_user(user.id).await.map_err(AppError::Internal)?;
    let (sid, session) = state.sessions.create(user.id).await.map_err(AppError::Internal)?;

    let cookie = Cookie::build((COOKIE_NAME, sid))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax)
        .path("/")
        .build();

    Ok((
        jar.add(cookie),
        Json(json!({ "user_id": user.id, "csrf_token": session.csrf_token })),
    ))
}

/// A valid PHC string for a password nobody has. Keeps the failure path's cost
/// equal to the success path's.
const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$K1kMhIQ0kUJhQ9lRxYlLmC6cNfHUJ0Q0lB0FhTgsBnQ";

pub async fn logout(
    State(state): State<AppState>,
    jar: SignedCookieJar,
    CurrentSession(session): CurrentSession,
) -> Result<impl IntoResponse, AppError> {
    state
        .sessions
        .delete_for_user(session.user_id)
        .await
        .map_err(AppError::Internal)?;
    Ok((jar.remove(Cookie::from(COOKIE_NAME)), StatusCode::NO_CONTENT))
}

pub async fn csrf(CurrentSession(session): CurrentSession) -> Json<serde_json::Value> {
    Json(json!({ "csrf_token": session.csrf_token }))
}

pub async fn me(CurrentSession(session): CurrentSession) -> Json<MeResponse> {
    Json(MeResponse { user_id: session.user_id })
}
```

Regenerate `DUMMY_HASH` once with `hash("a password nobody has")` and paste the real output — the value above is illustrative and will not parse.

- [ ] **Step 4: Split the router into public and protected halves**

In `crates/iknos-api/src/lib.rs`:

```rust
pub fn router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/api/csrf", get(auth::routes::csrf))
        .route("/api/me", get(auth::routes::me))
        .route("/api/auth/logout", post(auth::routes::logout))
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::layer::require_session,
        ));

    let public = Router::new()
        .route("/health", get(health::health))
        .route("/api/auth/login", post(auth::routes::login));

    public.merge(protected).with_state(state)
}
```

Every route added by a later task goes into `protected` unless the plan says otherwise.

- [ ] **Step 5: Seed the test account**

Run:

```bash
DATABASE_URL=$DATABASE_URL cargo run -p iknos-server -- user create test@iknos.local
```

Enter `test-password-1234` twice. The `/api/services` and `/api/logs` entries in the first test will 404 rather than 401 until Tasks 17 and 20 land; add them to the loop then, or accept `404` alongside `401` there for now by asserting `status != StatusCode::OK`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p iknos-api --test auth`
Expected: PASS, 4 tests.

- [ ] **Step 7: Verify from outside the test harness**

Run with the server up:

```bash
curl -si localhost:4310/api/me | head -1
```

Expected: `HTTP/1.1 401 Unauthorized`. This is the spec's acceptance criterion — verified in `curl`, not only in a browser.

- [ ] **Step 8: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(auth): login, logout, csrf and me routes"
```

---

## Task 14: Login rate limiting

**Files:**
- Create: `crates/iknos-api/src/auth/ratelimit.rs`
- Modify: `crates/iknos-api/src/auth/routes.rs`, `crates/iknos-api/src/auth/mod.rs`, `crates/iknos-api/src/lib.rs`

**Interfaces:**
- Produces: `auth::ratelimit::check(store: &SessionStore, ip: &str) -> anyhow::Result<bool>` — returns `false` once the caller has exceeded 5 attempts in the current minute.

- [ ] **Step 1: Write the failing test**

`crates/iknos-api/tests/ratelimit.rs`:

```rust
use iknos_api::auth::{ratelimit, session::SessionStore};

#[tokio::test]
async fn allows_five_then_refuses() {
    let url = std::env::var("REDIS_URL").expect("REDIS_URL");
    let store = SessionStore::new(&url).await.unwrap();
    // A distinct key per run, so repeated test runs do not poison each other.
    let ip = format!("test-{}", uuid::Uuid::new_v4());

    for i in 1..=5 {
        assert!(ratelimit::check(&store, &ip).await.unwrap(), "attempt {i} should pass");
    }
    assert!(!ratelimit::check(&store, &ip).await.unwrap(), "6th attempt must be refused");
}

#[tokio::test]
async fn counts_each_ip_separately() {
    let url = std::env::var("REDIS_URL").expect("REDIS_URL");
    let store = SessionStore::new(&url).await.unwrap();
    let a = format!("test-{}", uuid::Uuid::new_v4());
    let b = format!("test-{}", uuid::Uuid::new_v4());

    for _ in 0..6 {
        let _ = ratelimit::check(&store, &a).await.unwrap();
    }
    assert!(ratelimit::check(&store, &b).await.unwrap(), "a different ip must be unaffected");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-api --test ratelimit`
Expected: FAIL — `unresolved import iknos_api::auth::ratelimit`.

- [ ] **Step 3: Implement the limiter**

Run `cargo add -p iknos-api uuid --features v4 --dev`.

`crates/iknos-api/src/auth/ratelimit.rs`:

```rust
use redis::AsyncCommands;

use super::session::SessionStore;

const MAX_ATTEMPTS: u32 = 5;
const WINDOW_SECONDS: i64 = 60;

/// Fixed-window counter. Returns false once the window's budget is spent.
/// Reuses the session store's Redis connection rather than opening a second one.
pub async fn check(store: &SessionStore, ip: &str) -> anyhow::Result<bool> {
    let mut conn = store.connection();
    let key = format!("iknos:rl:login:{ip}");

    let count: u32 = conn.incr(&key, 1u32).await?;
    if count == 1 {
        // Only the first call in a window sets the expiry, so a burst cannot
        // keep pushing the window forward and lock the caller out indefinitely.
        let _: () = conn.expire(&key, WINDOW_SECONDS).await?;
    }

    Ok(count <= MAX_ATTEMPTS)
}
```

Add to `SessionStore` in `crates/iknos-api/src/auth/session.rs`:

```rust
    pub fn connection(&self) -> redis::aio::ConnectionManager {
        self.conn.clone()
    }
```

Add `pub mod ratelimit;` to `crates/iknos-api/src/auth/mod.rs`.

- [ ] **Step 4: Apply it to login**

At the top of the `login` handler in `crates/iknos-api/src/auth/routes.rs`, add the client IP extractor and the check:

```rust
use axum_client_ip::ClientIp;

pub async fn login(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    jar: SignedCookieJar,
    Json(body): Json<LoginBody>,
) -> Result<impl IntoResponse, AppError> {
    if !super::ratelimit::check(&state.sessions, &ip.to_string())
        .await
        .map_err(AppError::Internal)?
    {
        return Err(AppError::TooManyRequests);
    }
    // ... existing body
```

Run `cargo add -p iknos-api axum-client-ip`. In `main.rs`, configure it for a single trusted proxy so the count keys on the real client rather than on nginx's loopback address — otherwise every request shares one bucket and the first five logins of the minute lock out everyone. Follow the crate's current guidance for the `RightmostXForwardedFor` (or equivalent) source, and make nginx set `X-Forwarded-For` in Task 24.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p iknos-api`
Expected: PASS, all suites.

- [ ] **Step 6: Verify end to end**

Run with the server up:

```bash
for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4310/api/auth/login -H 'content-type: application/json' -d '{"email":"x@y.z","password":"nope"}'; done
```

Expected: five `401` then `429`.

- [ ] **Step 7: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(auth): rate limit login attempts per ip"
```

---

## Task 15: Line framing

**Files:**
- Create: `crates/iknos-ingest/src/line_buffer.rs`, `crates/iknos-ingest/src/lib.rs`

**Interfaces:**
- Produces: `LineBuffer::new()`, `push(&mut self, chunk: &[u8])`, `next_line(&mut self) -> Option<String>`, `pending_bytes(&self) -> usize`. Task 17's tailer feeds it; Task 16's parser consumes its output.

This is the smallest piece of the project and the one most worth getting exactly right. A read can land anywhere — mid-line, mid-codepoint — and the whole no-corruption property rests here.

- [ ] **Step 1: Write the failing test**

At the bottom of `crates/iknos-ingest/src/line_buffer.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yields_complete_lines_only() {
        let mut b = LineBuffer::new();
        b.push(b"first\nsecond\npartial");

        assert_eq!(b.next_line().as_deref(), Some("first"));
        assert_eq!(b.next_line().as_deref(), Some("second"));
        assert_eq!(b.next_line(), None, "a line without a newline is not complete");
        assert_eq!(b.pending_bytes(), "partial".len());
    }

    #[test]
    fn reassembles_a_line_split_across_reads() {
        let mut b = LineBuffer::new();
        b.push(b"hello ");
        assert_eq!(b.next_line(), None);
        b.push(b"world\n");
        assert_eq!(b.next_line().as_deref(), Some("hello world"));
    }

    #[test]
    fn survives_a_read_that_splits_a_utf8_codepoint() {
        // "é" is 0xC3 0xA9. A read boundary between the two bytes is the exact
        // case that corrupts naive implementations.
        let mut b = LineBuffer::new();
        b.push(&[b'c', b'a', b'f', 0xC3]);
        assert_eq!(b.next_line(), None, "must not decode a half codepoint");
        b.push(&[0xA9, b'\n']);
        assert_eq!(b.next_line().as_deref(), Some("café"));
    }

    #[test]
    fn strips_a_trailing_carriage_return() {
        let mut b = LineBuffer::new();
        b.push(b"windows\r\n");
        assert_eq!(b.next_line().as_deref(), Some("windows"));
    }

    #[test]
    fn yields_empty_lines_rather_than_swallowing_them() {
        let mut b = LineBuffer::new();
        b.push(b"\n\na\n");
        assert_eq!(b.next_line().as_deref(), Some(""));
        assert_eq!(b.next_line().as_deref(), Some(""));
        assert_eq!(b.next_line().as_deref(), Some("a"));
    }

    #[test]
    fn replaces_genuinely_invalid_utf8_without_failing() {
        let mut b = LineBuffer::new();
        b.push(&[b'a', 0xFF, b'b', b'\n']);
        let line = b.next_line().expect("a line");
        assert!(line.starts_with('a') && line.ends_with('b'), "got: {line:?}");
    }

    #[test]
    fn drops_the_buffer_if_a_single_line_grows_absurd() {
        let mut b = LineBuffer::new();
        b.push(&vec![b'x'; MAX_LINE_BYTES + 1]);
        assert_eq!(b.pending_bytes(), 0, "an unbounded line must not grow forever");
    }
}
```

The last test guards against a file with no newlines at all — without a cap, the buffer grows until the process is killed.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-ingest`
Expected: FAIL — `cannot find type 'LineBuffer'`.

- [ ] **Step 3: Implement the buffer**

Run `cargo add -p iknos-ingest bytes tracing --workspace` (tracing from the workspace table, bytes fresh).

At the top of `crates/iknos-ingest/src/line_buffer.rs`:

```rust
use bytes::{Buf, BytesMut};

/// A single log line longer than this is treated as garbage rather than
/// buffered indefinitely. Real ECS lines are a few kilobytes at most.
pub const MAX_LINE_BYTES: usize = 1024 * 1024;

#[derive(Default)]
pub struct LineBuffer {
    buf: BytesMut,
}

impl LineBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) {
        self.buf.extend_from_slice(chunk);

        if self.buf.len() > MAX_LINE_BYTES && !self.buf.contains(&b'\n') {
            tracing::warn!(
                bytes = self.buf.len(),
                "discarding an over-long line with no newline"
            );
            self.buf.clear();
        }
    }

    /// Returns the next complete line, or None if no newline has arrived yet.
    /// Bytes are held as bytes until a full line exists, so a read boundary
    /// inside a multi-byte codepoint cannot corrupt anything.
    pub fn next_line(&mut self) -> Option<String> {
        let idx = self.buf.iter().position(|&b| b == b'\n')?;

        let mut line = self.buf.split_to(idx + 1);
        line.truncate(idx); // drop the '\n'
        if line.last() == Some(&b'\r') {
            line.truncate(line.len() - 1);
        }

        Some(String::from_utf8_lossy(&line).into_owned())
    }

    pub fn pending_bytes(&self) -> usize {
        self.buf.remaining()
    }
}
```

`crates/iknos-ingest/src/lib.rs`:

```rust
pub mod line_buffer;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-ingest`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/iknos-ingest Cargo.lock
git commit -m "feat(ingest): byte-safe line framing across read boundaries"
```

---

## Task 16: Log line parser

**Files:**
- Create: `crates/iknos-ingest/src/parser.rs`, `crates/iknos-core/src/log_record.rs`
- Modify: `crates/iknos-ingest/src/lib.rs`, `crates/iknos-core/src/lib.rs`

**Interfaces:**
- Produces: `iknos_core::LogRecord` with fields `ts: DateTime<Utc>`, `service: String`, `level: i16`, `level_name: String`, `logger: Option<String>`, `message: String`, `trace_id: Option<String>`, `http_method: Option<String>`, `route: Option<String>`, `status_code: Option<i16>`, `duration_ms: Option<i32>`, `client_ip: Option<String>`, `user_id: Option<String>`, `hostname: Option<String>`, `attrs: Option<serde_json::Value>`. And `parser::parse(line: &str, service: &str, stream: Stream) -> Option<LogRecord>` where `Stream` is `Out | Err`. `None` means the line was deliberately skipped. Tasks 18 and 19 both carry `LogRecord`.

- [ ] **Step 1: Write the failing test**

At the bottom of `crates/iknos-ingest/src/parser.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn parse_out(line: &str) -> LogRecord {
        parse(line, "pfa-api", Stream::Out).expect("should parse")
    }

    #[test]
    fn reads_ecs_with_dotted_keys() {
        let line = r#"{"@timestamp":"2026-08-09T10:11:12.345Z","log.level":"error","message":"boom","trace.id":"abc","http.request.method":"GET","url.path":"/api/users","http.response.status_code":500,"client.ip":"1.2.3.4"}"#;
        let r = parse_out(line);

        assert_eq!(r.level_name, "error");
        assert_eq!(r.level, 50);
        assert_eq!(r.message, "boom");
        assert_eq!(r.trace_id.as_deref(), Some("abc"));
        assert_eq!(r.http_method.as_deref(), Some("GET"));
        assert_eq!(r.route.as_deref(), Some("/api/users"));
        assert_eq!(r.status_code, Some(500));
        assert_eq!(r.client_ip.as_deref(), Some("1.2.3.4"));
        assert_eq!(r.ts.timestamp_millis(), 1786character_placeholder);
    }

    #[test]
    fn reads_ecs_with_nested_keys() {
        // The ECS spec permits both shapes; pino and hand-rolled loggers differ.
        let line = r#"{"@timestamp":"2026-08-09T10:11:12.345Z","log":{"level":"warn","logger":"http"},"message":"slow","trace":{"id":"xyz"}}"#;
        let r = parse_out(line);

        assert_eq!(r.level_name, "warn");
        assert_eq!(r.level, 40);
        assert_eq!(r.logger.as_deref(), Some("http"));
        assert_eq!(r.trace_id.as_deref(), Some("xyz"));
    }

    #[test]
    fn keeps_unknown_fields_in_attrs() {
        let line = r#"{"@timestamp":"2026-08-09T10:11:12.345Z","log.level":"info","message":"m","orderId":42}"#;
        let r = parse_out(line);
        let attrs = r.attrs.expect("attrs");
        assert_eq!(attrs["orderId"], 42);
        assert!(attrs.get("message").is_none(), "promoted fields must not be duplicated");
    }

    #[test]
    fn falls_back_for_json_without_ecs() {
        let line = r#"{"msg":"hello","pid":17}"#;
        let r = parse_out(line);
        assert_eq!(r.message, "hello");
        assert_eq!(r.attrs.expect("attrs")["pid"], 17);
    }

    #[test]
    fn treats_plain_text_as_a_message() {
        let r = parse_out("Server started on port 3000");
        assert_eq!(r.message, "Server started on port 3000");
        assert_eq!(r.level_name, "info");
    }

    #[test]
    fn infers_error_level_from_the_stream() {
        let r = parse("something failed", "pfa-api", Stream::Err).unwrap();
        assert_eq!(r.level_name, "error");
        assert_eq!(r.level, 50);
    }

    #[test]
    fn refines_level_from_a_common_prefix() {
        let r = parse_out("WARN  deprecation notice");
        assert_eq!(r.level_name, "warn");
    }

    #[test]
    fn strips_ansi_escapes() {
        let r = parse_out("\u{1b}[32m[Nest]\u{1b}[0m started");
        assert!(!r.message.contains('\u{1b}'), "got: {:?}", r.message);
        assert!(r.message.contains("[Nest]"));
    }

    #[test]
    fn stores_truncated_json_as_plain_text_rather_than_failing() {
        let r = parse_out(r#"{"@timestamp":"2026-08-09T10:11:12.345Z","mess"#);
        assert!(r.message.starts_with('{'));
        assert_eq!(r.level_name, "info");
    }

    #[test]
    fn skips_the_self_error_marker() {
        let line = format!("{} database unreachable", iknos_core::telemetry::INGEST_SKIP_MARKER);
        assert!(parse(&line, "iknos", Stream::Err).is_none(), "must not re-ingest its own failures");
    }

    #[test]
    fn falls_back_to_now_when_the_timestamp_is_unparseable() {
        let line = r#"{"@timestamp":"not-a-date","log.level":"info","message":"m"}"#;
        let before = chrono::Utc::now();
        let r = parse_out(line);
        assert!(r.ts >= before - chrono::Duration::seconds(2));
    }
}
```

Replace `1786character_placeholder` with the actual epoch-millis value of `2026-08-09T10:11:12.345Z` — compute it once with `date -u -d '2026-08-09T10:11:12.345Z' +%s%3N` and paste the number.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-ingest parser`
Expected: FAIL — `cannot find function 'parse'`.

- [ ] **Step 3: Define LogRecord**

`crates/iknos-core/src/log_record.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogRecord {
    pub ts: DateTime<Utc>,
    pub service: String,
    pub level: i16,
    pub level_name: String,
    pub logger: Option<String>,
    pub message: String,
    pub trace_id: Option<String>,
    pub http_method: Option<String>,
    pub route: Option<String>,
    pub status_code: Option<i16>,
    pub duration_ms: Option<i32>,
    pub client_ip: Option<String>,
    pub user_id: Option<String>,
    pub hostname: Option<String>,
    pub attrs: Option<serde_json::Value>,
}
```

Add `pub mod log_record; pub use log_record::LogRecord;` to `crates/iknos-core/src/lib.rs`.

- [ ] **Step 4: Implement the parser**

Run `cargo add -p iknos-ingest serde_json chrono --workspace && cargo add -p iknos-ingest strip-ansi-escapes && cargo add -p iknos-ingest iknos-core --path crates/iknos-core`.

At the top of `crates/iknos-ingest/src/parser.rs`:

```rust
use chrono::{DateTime, Utc};
use iknos_core::{LogRecord, telemetry::INGEST_SKIP_MARKER};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    Out,
    Err,
}

/// pino's numeric levels, which the UI sorts and filters on.
fn level_number(name: &str) -> i16 {
    match name.to_ascii_lowercase().as_str() {
        "trace" => 10,
        "debug" => 20,
        "info" => 30,
        "warn" | "warning" => 40,
        "error" => 50,
        "fatal" | "crit" | "critical" => 60,
        _ => 30,
    }
}

/// Looks a key up in both ECS shapes: the dotted form ("log.level") and the
/// nested form ({"log":{"level":...}}). Loggers differ, and we accept both.
fn lookup<'a>(obj: &'a Map<String, Value>, dotted: &str) -> Option<&'a Value> {
    if let Some(v) = obj.get(dotted) {
        return Some(v);
    }
    let mut cur = obj;
    let mut parts = dotted.split('.').peekable();
    while let Some(part) = parts.next() {
        let v = cur.get(part)?;
        if parts.peek().is_none() {
            return Some(v);
        }
        cur = v.as_object()?;
    }
    None
}

fn as_string(v: Option<&Value>) -> Option<String> {
    v.and_then(|v| v.as_str()).map(str::to_string)
}

fn as_i16(v: Option<&Value>) -> Option<i16> {
    v.and_then(|v| v.as_i64()).and_then(|n| i16::try_from(n).ok())
}

pub fn parse(line: &str, service: &str, stream: Stream) -> Option<LogRecord> {
    // Never re-ingest our own write failures.
    if line.contains(INGEST_SKIP_MARKER) {
        return None;
    }

    let clean = strip_ansi_escapes::strip_str(line);
    let trimmed = clean.trim();
    if trimmed.is_empty() {
        return None;
    }

    let default_level = match stream {
        Stream::Out => "info",
        Stream::Err => "error",
    };

    let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(trimmed) else {
        return Some(plain_text(trimmed, service, default_level));
    };

    let is_ecs = obj.contains_key("@timestamp") || lookup(&obj, "log.level").is_some();
    if !is_ecs {
        // Valid JSON, unknown shape: keep msg as the message, everything as attrs.
        let message = as_string(obj.get("msg"))
            .or_else(|| as_string(obj.get("message")))
            .unwrap_or_else(|| trimmed.to_string());
        let mut r = plain_text(&message, service, default_level);
        r.attrs = Some(Value::Object(obj));
        return Some(r);
    }

    let level_name = as_string(lookup(&obj, "log.level")).unwrap_or_else(|| default_level.into());
    let ts = as_string(obj.get("@timestamp"))
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    // Whatever we promote to a column is removed from attrs, so nothing is stored twice.
    const PROMOTED: &[&str] = &[
        "@timestamp", "log.level", "log.logger", "message", "trace.id",
        "http.request.method", "url.path", "http.response.status_code",
        "event.duration", "client.ip", "user.id", "host.hostname", "ecs.version",
    ];
    let mut attrs = obj.clone();
    for key in PROMOTED {
        attrs.remove(*key);
        if let Some(root) = key.split('.').next() {
            if key.contains('.') {
                attrs.remove(root);
            }
        }
    }

    Some(LogRecord {
        ts,
        service: service.to_string(),
        level: level_number(&level_name),
        level_name,
        logger: as_string(lookup(&obj, "log.logger")),
        message: as_string(obj.get("message")).unwrap_or_default(),
        trace_id: as_string(lookup(&obj, "trace.id")),
        http_method: as_string(lookup(&obj, "http.request.method")),
        route: as_string(lookup(&obj, "url.path")),
        status_code: as_i16(lookup(&obj, "http.response.status_code")),
        // ECS event.duration is nanoseconds.
        duration_ms: lookup(&obj, "event.duration")
            .and_then(|v| v.as_i64())
            .map(|ns| (ns / 1_000_000) as i32),
        client_ip: as_string(lookup(&obj, "client.ip")),
        user_id: as_string(lookup(&obj, "user.id")),
        hostname: as_string(lookup(&obj, "host.hostname")),
        attrs: (!attrs.is_empty()).then(|| Value::Object(attrs)),
    })
}

fn plain_text(message: &str, service: &str, default_level: &str) -> LogRecord {
    let level_name = infer_level(message, default_level);
    LogRecord {
        ts: Utc::now(),
        service: service.to_string(),
        level: level_number(&level_name),
        level_name,
        logger: None,
        message: message.to_string(),
        trace_id: None,
        http_method: None,
        route: None,
        status_code: None,
        duration_ms: None,
        client_ip: None,
        user_id: None,
        hostname: None,
        attrs: None,
    }
}

fn infer_level(message: &str, default_level: &str) -> String {
    let head: String = message.chars().take(24).collect::<String>().to_ascii_uppercase();
    for (needle, level) in [
        ("FATAL", "fatal"), ("ERROR", "error"), ("ERR", "error"),
        ("WARN", "warn"), ("DEBUG", "debug"), ("TRACE", "trace"),
    ] {
        if head.contains(needle) {
            return level.to_string();
        }
    }
    default_level.to_string()
}
```

Add `pub mod parser;` to `crates/iknos-ingest/src/lib.rs`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p iknos-ingest`
Expected: PASS, 18 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(ingest): ECS, bare JSON and plain text line parsing"
```

---

## Task 17: Offset store and rotation logic

**Files:**
- Create: `crates/iknos-store/src/offsets.rs`, `crates/iknos-ingest/src/tailer.rs`
- Modify: `crates/iknos-store/src/lib.rs`, `crates/iknos-ingest/src/lib.rs`

**Interfaces:**
- Produces: `iknos_store::offsets::{FileOffset, load_all, save_in_tx}` where `FileOffset { file_path: String, dev: u64, inode: u64, byte_offset: u64 }` and `save_in_tx(tx: &mut Transaction<'_, MySql>, o: &FileOffset) -> sqlx::Result<()>`. Also `iknos_ingest::tailer::{decide, Action, FileStat}` — the pure rotation decision — and `tailer::run`. Task 18 calls `save_in_tx`.

The rotation decision is pulled out as a pure function so it can be tested exhaustively without touching a filesystem. The I/O loop around it is thin.

- [ ] **Step 1: Write the failing test**

At the bottom of `crates/iknos-ingest/src/tailer.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const STORED: FileOffset = FileOffset { dev: 1, inode: 100, byte_offset: 500 };

    #[test]
    fn resumes_when_the_file_is_unchanged_and_has_grown() {
        let now = FileStat { dev: 1, inode: 100, len: 900 };
        assert_eq!(decide(Some(STORED), now), Action::ReadFrom(500));
    }

    #[test]
    fn does_nothing_when_there_is_nothing_new() {
        let now = FileStat { dev: 1, inode: 100, len: 500 };
        assert_eq!(decide(Some(STORED), now), Action::Idle);
    }

    #[test]
    fn restarts_from_zero_when_the_inode_changed() {
        let now = FileStat { dev: 1, inode: 101, len: 20 };
        assert_eq!(decide(Some(STORED), now), Action::RestartFrom(0));
    }

    #[test]
    fn restarts_from_zero_when_the_device_changed() {
        // A file moved across filesystems keeps its inode number by coincidence
        // often enough that dev must be part of the identity.
        let now = FileStat { dev: 2, inode: 100, len: 900 };
        assert_eq!(decide(Some(STORED), now), Action::RestartFrom(0));
    }

    #[test]
    fn restarts_from_zero_when_the_file_was_truncated() {
        let now = FileStat { dev: 1, inode: 100, len: 12 };
        assert_eq!(decide(Some(STORED), now), Action::RestartFrom(0));
    }

    #[test]
    fn reads_a_brand_new_file_from_the_start() {
        let now = FileStat { dev: 1, inode: 100, len: 42 };
        assert_eq!(decide(None, now), Action::RestartFrom(0));
    }

    #[test]
    fn an_empty_new_file_is_idle_not_a_read_of_nothing() {
        let now = FileStat { dev: 1, inode: 100, len: 0 };
        assert_eq!(decide(None, now), Action::Idle);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-ingest tailer`
Expected: FAIL — `cannot find function 'decide'`.

- [ ] **Step 3: Implement the decision function**

At the top of `crates/iknos-ingest/src/tailer.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileOffset {
    pub dev: u64,
    pub inode: u64,
    pub byte_offset: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStat {
    pub dev: u64,
    pub inode: u64,
    pub len: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Nothing new to read.
    Idle,
    /// Continue an existing file from this byte position.
    ReadFrom(u64),
    /// The file is new or was replaced; read from this position and reset the
    /// stored identity.
    RestartFrom(u64),
}

pub fn decide(stored: Option<FileOffset>, now: FileStat) -> Action {
    match stored {
        None if now.len == 0 => Action::Idle,
        None => Action::RestartFrom(0),
        Some(prev) => {
            let replaced = prev.dev != now.dev || prev.inode != now.inode;
            let truncated = now.len < prev.byte_offset;

            if replaced || truncated {
                if now.len == 0 { Action::Idle } else { Action::RestartFrom(0) }
            } else if now.len > prev.byte_offset {
                Action::ReadFrom(prev.byte_offset)
            } else {
                Action::Idle
            }
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-ingest tailer`
Expected: PASS, 7 tests.

- [ ] **Step 5: Implement the offset store**

`crates/iknos-store/src/offsets.rs`:

```rust
use sqlx::{MySql, MySqlPool, Transaction};

#[derive(Debug, Clone)]
pub struct FileOffset {
    pub file_path: String,
    pub dev: u64,
    pub inode: u64,
    pub byte_offset: u64,
}

pub async fn load_all(pool: &MySqlPool) -> sqlx::Result<Vec<FileOffset>> {
    sqlx::query_as!(
        FileOffset,
        "SELECT file_path, dev AS `dev: u64`, inode AS `inode: u64`, \
                byte_offset AS `byte_offset: u64` FROM ingest_offset"
    )
    .fetch_all(pool)
    .await
}

/// Written inside the same transaction as the rows it accounts for. That
/// atomicity is the whole no-loss-no-duplicate guarantee.
pub async fn save_in_tx(
    tx: &mut Transaction<'_, MySql>,
    o: &FileOffset,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO ingest_offset (file_path, dev, inode, byte_offset, updated_at) \
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3)) \
         ON DUPLICATE KEY UPDATE dev = VALUES(dev), inode = VALUES(inode), \
                                 byte_offset = VALUES(byte_offset), \
                                 updated_at = CURRENT_TIMESTAMP(3)",
        o.file_path,
        o.dev,
        o.inode,
        o.byte_offset
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

Add `pub mod offsets;` to `crates/iknos-store/src/lib.rs`.

- [ ] **Step 6: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(ingest): rotation decision and offset persistence"
```

---

## Task 18: Batch writer with transactional offsets

**Files:**
- Create: `crates/iknos-store/src/logs.rs`, `crates/iknos-ingest/src/writer.rs`, `crates/iknos-ingest/tests/durability.rs`
- Modify: `crates/iknos-store/src/lib.rs`, `crates/iknos-ingest/src/lib.rs`

**Interfaces:**
- Produces: `iknos_store::logs::insert_batch_with_offset(pool, records: &[LogRecord], offsets: &[FileOffset]) -> anyhow::Result<()>`, and `iknos_ingest::writer::{Chunk, run_writer}` where `Chunk { records: Vec<LogRecord>, offset: FileOffset }`. Task 19 spawns `run_writer`.

- [ ] **Step 1: Write the failing test**

`crates/iknos-ingest/tests/durability.rs`:

```rust
use iknos_core::LogRecord;
use iknos_store::offsets::FileOffset;

fn record(service: &str, message: &str) -> LogRecord {
    LogRecord {
        ts: chrono::Utc::now(),
        service: service.into(),
        level: 30,
        level_name: "info".into(),
        logger: None,
        message: message.into(),
        trace_id: None,
        http_method: None,
        route: None,
        status_code: None,
        duration_ms: None,
        client_ip: None,
        user_id: None,
        hostname: None,
        attrs: None,
    }
}

#[tokio::test]
async fn rows_and_offset_land_together() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = iknos_store::connect(&url, 4).await.unwrap();

    let service = format!("t-{}", uuid::Uuid::new_v4());
    let path = format!("/tmp/{service}.log");

    let records: Vec<_> = (0..250).map(|i| record(&service, &format!("line {i}"))).collect();
    let offset = FileOffset { file_path: path.clone(), dev: 1, inode: 2, byte_offset: 4096 };

    iknos_store::logs::insert_batch_with_offset(&pool, &records, std::slice::from_ref(&offset))
        .await
        .unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM log_entry WHERE service = ?")
        .bind(&service)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 250, "a batch larger than one statement must still be one commit");

    let stored = iknos_store::offsets::load_all(&pool).await.unwrap();
    let mine = stored.iter().find(|o| o.file_path == path).expect("offset saved");
    assert_eq!(mine.byte_offset, 4096);
}

#[tokio::test]
async fn a_failed_batch_leaves_no_rows_and_no_offset() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = iknos_store::connect(&url, 4).await.unwrap();

    let service = format!("t-{}", uuid::Uuid::new_v4());
    let path = format!("/tmp/{service}.log");

    // level_name is VARCHAR(16); an over-long value makes the INSERT fail.
    let mut bad = record(&service, "doomed");
    bad.level_name = "x".repeat(64);

    let offset = FileOffset { file_path: path.clone(), dev: 1, inode: 2, byte_offset: 99 };
    let result =
        iknos_store::logs::insert_batch_with_offset(&pool, &[bad], std::slice::from_ref(&offset)).await;
    assert!(result.is_err(), "the batch should have failed");

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM log_entry WHERE service = ?")
        .bind(&service)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "no rows may survive a rolled-back batch");

    let stored = iknos_store::offsets::load_all(&pool).await.unwrap();
    assert!(
        !stored.iter().any(|o| o.file_path == path),
        "the offset must not advance past rows that were never written"
    );
}
```

The second test is the important one. It proves that a crash or a database error cannot silently skip log lines — the offset never runs ahead of the data.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-ingest --test durability`
Expected: FAIL — `could not find 'logs' in 'iknos_store'`.

- [ ] **Step 3: Implement the batch insert**

Run `cargo add -p iknos-ingest uuid --features v4 --dev && cargo add -p iknos-ingest iknos-store --path crates/iknos-store && cargo add -p iknos-ingest sqlx --features mysql,runtime-tokio,tls-rustls,chrono,json,macros --no-default-features`.

`crates/iknos-store/src/logs.rs`:

```rust
use iknos_core::LogRecord;
use sqlx::{MySqlPool, QueryBuilder};

use crate::offsets::{self, FileOffset};

/// MySQL's default max_allowed_packet is 64MB, but very wide multi-row inserts
/// also cost parse time. 500 rows per statement is comfortably inside both.
const ROWS_PER_STATEMENT: usize = 500;

pub async fn insert_batch_with_offset(
    pool: &MySqlPool,
    records: &[LogRecord],
    offsets: &[FileOffset],
) -> anyhow::Result<()> {
    if records.is_empty() && offsets.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    for chunk in records.chunks(ROWS_PER_STATEMENT) {
        let mut qb = QueryBuilder::new(
            "INSERT INTO log_entry (ts, service, level, level_name, logger, message, \
             trace_id, http_method, route, status_code, duration_ms, client_ip, \
             user_id, hostname, attrs) ",
        );
        qb.push_values(chunk, |mut b, r| {
            b.push_bind(r.ts)
                .push_bind(&r.service)
                .push_bind(r.level)
                .push_bind(&r.level_name)
                .push_bind(&r.logger)
                .push_bind(&r.message)
                .push_bind(&r.trace_id)
                .push_bind(&r.http_method)
                .push_bind(&r.route)
                .push_bind(r.status_code)
                .push_bind(r.duration_ms)
                .push_bind(&r.client_ip)
                .push_bind(&r.user_id)
                .push_bind(&r.hostname)
                .push_bind(&r.attrs);
        });
        qb.build().execute(&mut *tx).await?;
    }

    for o in offsets {
        offsets::save_in_tx(&mut tx, o).await?;
    }

    tx.commit().await?;
    Ok(())
}
```

Add `pub mod logs;` to `crates/iknos-store/src/lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-ingest --test durability`
Expected: PASS, 2 tests.

- [ ] **Step 5: Implement the writer loop**

`crates/iknos-ingest/src/writer.rs`:

```rust
use std::collections::HashMap;
use std::time::Duration;

use iknos_core::{LogRecord, telemetry::INGEST_SKIP_MARKER};
use iknos_store::offsets::FileOffset;
use sqlx::MySqlPool;
use tokio::sync::{broadcast, mpsc};

const MAX_ROWS: usize = 200;
const MAX_WAIT: Duration = Duration::from_millis(500);

pub struct Chunk {
    pub records: Vec<LogRecord>,
    pub offset: FileOffset,
}

pub async fn run_writer(
    pool: MySqlPool,
    mut rx: mpsc::Receiver<Chunk>,
    live: broadcast::Sender<LogRecord>,
) -> anyhow::Result<()> {
    let mut records: Vec<LogRecord> = Vec::with_capacity(MAX_ROWS);
    // Keyed by path so the latest offset per file wins within a batch.
    let mut offsets: HashMap<String, FileOffset> = HashMap::new();
    let mut ticker = tokio::time::interval(MAX_WAIT);

    loop {
        let flush = tokio::select! {
            maybe = rx.recv() => match maybe {
                Some(chunk) => {
                    offsets.insert(chunk.offset.file_path.clone(), chunk.offset);
                    records.extend(chunk.records);
                    records.len() >= MAX_ROWS
                }
                None => {
                    flush_batch(&pool, &mut records, &mut offsets, &live).await;
                    return Ok(());
                }
            },
            _ = ticker.tick() => !records.is_empty() || !offsets.is_empty(),
        };

        if flush {
            flush_batch(&pool, &mut records, &mut offsets, &live).await;
        }
    }
}

async fn flush_batch(
    pool: &MySqlPool,
    records: &mut Vec<LogRecord>,
    offsets: &mut HashMap<String, FileOffset>,
    live: &broadcast::Sender<LogRecord>,
) {
    if records.is_empty() && offsets.is_empty() {
        return;
    }

    let batch: Vec<FileOffset> = offsets.values().cloned().collect();

    match iknos_store::logs::insert_batch_with_offset(pool, records, &batch).await {
        Ok(()) => {
            // Only fan out after the commit, so live tail never shows a line
            // that was rolled back. A send error just means nobody is watching.
            for r in records.drain(..) {
                let _ = live.send(r);
            }
            offsets.clear();
        }
        Err(e) => {
            // Straight to stderr with the marker, never through tracing: this is
            // the path that would otherwise log its own failure, ingest that log,
            // and fail again.
            eprintln!("{INGEST_SKIP_MARKER} failed to write batch: {e}");
            records.clear();
            offsets.clear();
        }
    }
}
```

Dropping the batch on failure is deliberate: the offset was not committed either, so the tailer re-reads those bytes on the next pass once the database is back.

Add `pub mod writer;` to `crates/iknos-ingest/src/lib.rs`.

- [ ] **Step 6: Verify the whole crate still passes**

Run: `cargo test -p iknos-ingest`
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(ingest): batching writer committing rows and offsets atomically"
```

---

## Task 19: Tailer loop and server wiring

**Files:**
- Modify: `crates/iknos-ingest/src/tailer.rs`, `crates/iknos-ingest/src/lib.rs`, `crates/iknos-server/src/main.rs`, `crates/iknos-api/src/lib.rs`

**Interfaces:**
- Produces: `iknos_ingest::run_ingestion(pool, glob: String, tx: mpsc::Sender<Chunk>, shutdown: CancellationToken) -> anyhow::Result<()>`, and `AppState` gains `live: broadcast::Sender<LogRecord>`. Task 21 subscribes to `live`.

- [ ] **Step 1: Write the failing integration test**

`crates/iknos-ingest/tests/tail_roundtrip.rs`:

```rust
use std::io::Write;
use std::time::Duration;

use iknos_core::supervisor::CancellationToken;
use tokio::sync::{broadcast, mpsc};

#[tokio::test]
async fn a_line_written_to_a_file_reaches_the_database() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = iknos_store::connect(&url, 4).await.unwrap();

    let dir = tempfile::tempdir().unwrap();
    let service = format!("t{}", uuid::Uuid::new_v4().simple());
    let path = dir.path().join(format!("{service}-out.log"));
    std::fs::write(&path, "first line\n").unwrap();

    let (tx, rx) = mpsc::channel(64);
    let (live, _) = broadcast::channel(64);
    let shutdown = CancellationToken::new();

    let writer = tokio::spawn(iknos_ingest::writer::run_writer(pool.clone(), rx, live));
    let glob = format!("{}/*.log", dir.path().display());
    let tailer = tokio::spawn(iknos_ingest::run_ingestion(
        pool.clone(),
        glob,
        tx,
        shutdown.clone(),
    ));

    // Append after startup, to prove new bytes are picked up and not just the
    // initial contents.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
    writeln!(f, "second line").unwrap();
    drop(f);

    tokio::time::sleep(Duration::from_millis(2500)).await;
    shutdown.cancel();
    let _ = tokio::time::timeout(Duration::from_secs(5), tailer).await;
    let _ = tokio::time::timeout(Duration::from_secs(5), writer).await;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM log_entry WHERE service = ?")
        .bind(&service)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2, "both the initial and the appended line must be ingested");
}
```

Run `cargo add -p iknos-ingest tempfile --dev`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-ingest --test tail_roundtrip`
Expected: FAIL — `cannot find function 'run_ingestion'`.

- [ ] **Step 3: Implement the tailer loop**

Run `cargo add -p iknos-ingest glob tokio --workspace && cargo add -p iknos-ingest tokio-util --features rt`.

Append to `crates/iknos-ingest/src/tailer.rs`:

```rust
use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use iknos_core::supervisor::CancellationToken;
use iknos_store::offsets::FileOffset as StoredOffset;
use sqlx::MySqlPool;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::mpsc;

use crate::line_buffer::LineBuffer;
use crate::parser::{self, Stream};
use crate::writer::Chunk;

const POLL: Duration = Duration::from_secs(1);
const READ_CHUNK: usize = 256 * 1024;

/// PM2 names its files `<app>-out.log` and `<app>-error.log`.
fn service_and_stream(path: &Path) -> (String, Stream) {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown");
    if let Some(base) = stem.strip_suffix("-error") {
        (base.to_string(), Stream::Err)
    } else if let Some(base) = stem.strip_suffix("-out") {
        (base.to_string(), Stream::Out)
    } else {
        (stem.to_string(), Stream::Out)
    }
}

pub async fn run(
    pool: MySqlPool,
    glob_pattern: String,
    tx: mpsc::Sender<Chunk>,
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
    let mut known: HashMap<PathBuf, (FileOffset, LineBuffer)> = HashMap::new();

    for stored in iknos_store::offsets::load_all(&pool).await? {
        known.insert(
            PathBuf::from(&stored.file_path),
            (
                FileOffset {
                    dev: stored.dev,
                    inode: stored.inode,
                    byte_offset: stored.byte_offset,
                },
                LineBuffer::new(),
            ),
        );
    }

    let mut dropped: u64 = 0;
    let mut ticker = tokio::time::interval(POLL);

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => {
                tracing::info!(dropped, "tailer stopping");
                return Ok(());
            }
            _ = ticker.tick() => {}
        }

        // Re-globbing every tick is how new PM2 apps are picked up without a restart.
        let paths: Vec<PathBuf> = glob::glob(&glob_pattern)?.filter_map(Result::ok).collect();

        for path in paths {
            let Ok(meta) = tokio::fs::metadata(&path).await else { continue };
            let now = FileStat { dev: meta.dev(), inode: meta.ino(), len: meta.len() };

            let entry = known.entry(path.clone()).or_insert_with(|| {
                (FileOffset { dev: now.dev, inode: now.inode, byte_offset: 0 }, LineBuffer::new())
            });
            let stored = Some(entry.0);

            let start = match decide(stored, now) {
                Action::Idle => continue,
                Action::ReadFrom(pos) => pos,
                Action::RestartFrom(pos) => {
                    // A replaced file means the carried partial line belongs to a
                    // file that no longer exists. Discarding it is correct.
                    entry.1 = LineBuffer::new();
                    pos
                }
            };

            let Ok(mut file) = tokio::fs::File::open(&path).await else { continue };
            if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
                continue;
            }

            let mut pos = start;
            let (service, stream) = service_and_stream(&path);
            let mut buf = vec![0u8; READ_CHUNK];

            loop {
                let n = match file.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                pos += n as u64;
                entry.1.push(&buf[..n]);

                let mut records = Vec::new();
                while let Some(line) = entry.1.next_line() {
                    if let Some(r) = parser::parse(&line, &service, stream) {
                        records.push(r);
                    }
                }

                if records.is_empty() {
                    continue;
                }

                // Report the position of the last complete line, not the read
                // head: bytes still sitting in the buffer have not been stored.
                let committed = pos - entry.1.pending_bytes() as u64;
                let chunk = Chunk {
                    records,
                    offset: StoredOffset {
                        file_path: path.display().to_string(),
                        dev: now.dev,
                        inode: now.inode,
                        byte_offset: committed,
                    },
                };

                // Bounded channel: when the writer falls behind we drop lines
                // rather than grow a queue until the host dies.
                if tx.try_send(chunk).is_err() {
                    dropped += 1;
                    if dropped % 100 == 1 {
                        tracing::warn!(dropped, "ingest channel full, dropping lines");
                    }
                }
            }

            entry.0 = FileOffset { dev: now.dev, inode: now.inode, byte_offset: pos };
        }
    }
}
```

In `crates/iknos-ingest/src/lib.rs`:

```rust
pub mod line_buffer;
pub mod parser;
pub mod tailer;
pub mod writer;

pub use tailer::run as run_ingestion;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p iknos-ingest --test tail_roundtrip`
Expected: PASS, 1 test. It takes about 5 seconds — the poll interval is real time.

- [ ] **Step 5: Wire ingestion into the server**

In `crates/iknos-api/src/lib.rs`, add to `AppState`:

```rust
pub live: tokio::sync::broadcast::Sender<iknos_core::LogRecord>,
```

In `serve()` in `crates/iknos-server/src/main.rs`, before building the router:

```rust
    let (chunk_tx, chunk_rx) = tokio::sync::mpsc::channel(512);
    let (live_tx, _) = tokio::sync::broadcast::channel(1024);

    let writer_pool = pool.clone();
    let writer_live = live_tx.clone();
    tokio::spawn(iknos_ingest::writer::run_writer(writer_pool, chunk_rx, writer_live));

    let tail_pool = pool.clone();
    let glob = config.pm2_log_glob.clone();
    let tail_shutdown = shutdown.clone();
    iknos_core::supervisor::spawn_supervised("tailer", shutdown.clone(), move || {
        let pool = tail_pool.clone();
        let glob = glob.clone();
        let tx = chunk_tx.clone();
        let sd = tail_shutdown.clone();
        async move { iknos_ingest::run_ingestion(pool, glob, tx, sd).await }
    });
```

Add `live: live_tx` to the `AppState` construction and `iknos-ingest` to `iknos-server`'s dependencies.

- [ ] **Step 6: Verify end to end by hand**

Run the server, then:

```bash
echo '{"@timestamp":"2026-08-09T10:00:00.000Z","log.level":"info","message":"hello iknos"}' >> /tmp/iknos-demo-out.log
sleep 3 && mysql iknos -e "SELECT service, level_name, message FROM log_entry ORDER BY id DESC LIMIT 1"
```

with `IKNOS_PM2_LOG_GLOB=/tmp/iknos-demo*.log`.
Expected: one row, service `iknos-demo`, level `info`, message `hello iknos`.

- [ ] **Step 7: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(ingest): tailer loop wired into the server runtime"
```

---

## Task 20: Logs query endpoint

**Files:**
- Create: `crates/iknos-api/src/logs.rs`, `crates/iknos-api/src/services.rs`, `crates/iknos-api/tests/logs.rs`
- Modify: `crates/iknos-store/src/logs.rs`, `crates/iknos-store/src/services.rs`, `crates/iknos-api/src/lib.rs`

**Interfaces:**
- Produces: `GET /api/logs` and `GET /api/services`, plus the response types `LogRow` and `LogPage { rows: Vec<LogRow>, next_cursor: Option<String> }`, both deriving `ts_rs::TS` and exported to `web/src/types/`. Tasks 24 and 25 import those declarations.

- [ ] **Step 1: Write the failing test**

`crates/iknos-api/tests/logs.rs`:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use tower::ServiceExt;

mod common;
use common::{authed_cookie, test_app};

#[tokio::test]
async fn a_query_without_a_time_range_is_rejected() {
    let (app, cookie) = test_app().await;
    let res = app
        .oneshot(
            Request::builder()
                .uri("/api/logs")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        res.status(),
        StatusCode::BAD_REQUEST,
        "an unbounded query would scan every partition"
    );
}

#[tokio::test]
async fn filters_and_paginates_without_gaps_or_repeats() {
    let (app, cookie) = test_app().await;
    let service = common::seed_logs(120).await;

    let mut seen: Vec<String> = Vec::new();
    let mut cursor: Option<String> = None;

    for _ in 0..10 {
        let mut uri = format!(
            "/api/logs?from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z&service={service}&limit=50"
        );
        if let Some(c) = &cursor {
            uri.push_str(&format!("&cursor={c}"));
        }

        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(&uri)
                    .header(header::COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let body = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        let page: serde_json::Value = serde_json::from_slice(&body).unwrap();

        for row in page["rows"].as_array().unwrap() {
            seen.push(row["message"].as_str().unwrap().to_string());
        }
        cursor = page["next_cursor"].as_str().map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }

    assert_eq!(seen.len(), 120, "every row must be visited exactly once");
    let unique: std::collections::HashSet<_> = seen.iter().collect();
    assert_eq!(unique.len(), 120, "cursor paging must not repeat a row");
}

#[tokio::test]
async fn substring_search_finds_paths_and_trace_ids() {
    let (app, cookie) = test_app().await;
    let service = common::seed_one(&format!("GET /api/users/42 -> 200")).await;

    let res = app
        .oneshot(
            Request::builder()
                .uri(&format!(
                    "/api/logs?from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z&service={service}&q=%2Fapi%2Fusers%2F42"
                ))
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let body = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
    let page: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(page["rows"].as_array().unwrap().len(), 1, "this is the search FULLTEXT could not do");
}
```

Write `crates/iknos-api/tests/common/mod.rs` with `test_app()` (builds the router, logs in as `test@iknos.local`, returns the router and the `iknos.sid=` cookie string), `seed_logs(n)` and `seed_one(message)` (insert rows under a fresh random service name via `iknos_store::logs::insert_batch_with_offset`, returning the service name).

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-api --test logs`
Expected: FAIL — `/api/logs` returns 404.

- [ ] **Step 3: Implement the store query**

Append to `crates/iknos-store/src/logs.rs`:

```rust
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, serde::Serialize)]
pub struct LogRow {
    pub id: u64,
    pub ts: DateTime<Utc>,
    pub service: String,
    pub level: i16,
    pub level_name: String,
    pub message: String,
    pub trace_id: Option<String>,
    pub route: Option<String>,
    pub status_code: Option<i16>,
    pub duration_ms: Option<i32>,
}

#[derive(Debug, Clone, Default)]
pub struct LogQuery {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    pub service: Option<String>,
    pub min_level: Option<i16>,
    pub route: Option<String>,
    pub status_code: Option<i16>,
    pub q: Option<String>,
    /// Exclusive upper bound from the previous page: (ts, id).
    pub after: Option<(DateTime<Utc>, u64)>,
    pub limit: u32,
}

pub async fn search(pool: &MySqlPool, query: &LogQuery) -> sqlx::Result<Vec<LogRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT id, ts, service, level, level_name, message, trace_id, route, \
                status_code, duration_ms FROM log_entry WHERE ts >= ",
    );
    qb.push_bind(query.from).push(" AND ts < ").push_bind(query.to);

    if let Some(s) = &query.service {
        qb.push(" AND service = ").push_bind(s);
    }
    if let Some(l) = query.min_level {
        qb.push(" AND level >= ").push_bind(l);
    }
    if let Some(r) = &query.route {
        qb.push(" AND route = ").push_bind(r);
    }
    if let Some(c) = query.status_code {
        qb.push(" AND status_code = ").push_bind(c);
    }
    if let Some(q) = &query.q {
        // Escape the LIKE metacharacters so a user searching for "100%" gets
        // what they asked for.
        let escaped = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        qb.push(" AND message LIKE ").push_bind(format!("%{escaped}%"));
    }
    if let Some((ts, id)) = query.after {
        // Row-value comparison keeps the keyset ordering correct across rows
        // that share a millisecond.
        qb.push(" AND (ts, id) < (").push_bind(ts).push(", ").push_bind(id).push(")");
    }

    qb.push(" ORDER BY ts DESC, id DESC LIMIT ").push_bind(query.limit);

    qb.build_query_as::<LogRow>().fetch_all(pool).await
}
```

`LogRow` needs `sqlx::FromRow`; derive it alongside `Serialize`.

- [ ] **Step 4: Implement the handler**

Run `cargo add -p iknos-api ts-rs --features chrono-impl && cargo add -p iknos-api chrono --workspace`.

`crates/iknos-api/src/logs.rs`:

```rust
use axum::Json;
use axum::extract::{Query, State};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};
use iknos_core::AppError;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::AppState;
use crate::auth::layer::CurrentSession;

const MAX_LIMIT: u32 = 200;
const DEFAULT_LIMIT: u32 = 100;

#[derive(Deserialize)]
pub struct LogParams {
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub service: Option<String>,
    pub min_level: Option<i16>,
    pub route: Option<String>,
    pub status_code: Option<i16>,
    pub q: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../web/src/types/")]
pub struct LogRow {
    pub id: String,
    pub ts: String,
    pub service: String,
    pub level: i16,
    pub level_name: String,
    pub message: String,
    pub trace_id: Option<String>,
    pub route: Option<String>,
    pub status_code: Option<i16>,
    pub duration_ms: Option<i32>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../web/src/types/")]
pub struct LogPage {
    pub rows: Vec<LogRow>,
    pub next_cursor: Option<String>,
}

fn encode_cursor(ts: &DateTime<Utc>, id: u64) -> String {
    URL_SAFE_NO_PAD.encode(format!("{}:{}", ts.timestamp_millis(), id))
}

fn decode_cursor(raw: &str) -> Option<(DateTime<Utc>, u64)> {
    let bytes = URL_SAFE_NO_PAD.decode(raw).ok()?;
    let text = String::from_utf8(bytes).ok()?;
    let (ms, id) = text.split_once(':')?;
    Some((
        DateTime::from_timestamp_millis(ms.parse().ok()?)?,
        id.parse().ok()?,
    ))
}

pub async fn list(
    State(state): State<AppState>,
    CurrentSession(_): CurrentSession,
    Query(p): Query<LogParams>,
) -> Result<Json<LogPage>, AppError> {
    // Enforced here rather than defaulted: a forgotten range must be a loud 400,
    // not a silent full scan.
    let (Some(from), Some(to)) = (p.from, p.to) else {
        return Err(AppError::BadRequest(
            "both 'from' and 'to' are required".into(),
        ));
    };
    if to <= from {
        return Err(AppError::BadRequest("'to' must be after 'from'".into()));
    }

    let limit = p.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    let query = iknos_store::logs::LogQuery {
        from,
        to,
        service: p.service,
        min_level: p.min_level,
        route: p.route,
        status_code: p.status_code,
        q: p.q.filter(|s| !s.trim().is_empty()),
        after: p.cursor.as_deref().and_then(decode_cursor),
        // Fetch one extra to learn whether another page exists, without a COUNT.
        limit: limit + 1,
    };

    let mut found = iknos_store::logs::search(&state.pool, &query).await?;
    let has_more = found.len() as u32 > limit;
    found.truncate(limit as usize);

    let next_cursor = has_more
        .then(|| found.last().map(|r| encode_cursor(&r.ts, r.id)))
        .flatten();

    let rows = found
        .into_iter()
        .map(|r| LogRow {
            // id is u64; JSON numbers lose precision past 2^53, so it crosses as a string.
            id: r.id.to_string(),
            ts: r.ts.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            service: r.service,
            level: r.level,
            level_name: r.level_name,
            message: r.message,
            trace_id: r.trace_id,
            route: r.route,
            status_code: r.status_code,
            duration_ms: r.duration_ms,
        })
        .collect();

    Ok(Json(LogPage { rows, next_cursor }))
}
```

Add both routes to the `protected` router: `.route("/api/logs", get(logs::list))` and `.route("/api/services", get(services::list))`. Write `services::list` as a `SELECT id, name, pm2_name, enabled FROM service WHERE enabled = TRUE` returning a `TS`-deriving `ServiceRow`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p iknos-api --test logs`
Expected: PASS, 3 tests.

- [ ] **Step 6: Generate and commit the TypeScript declarations**

Run: `cargo test -p iknos-api export_bindings`
Expected: `web/src/types/LogRow.ts`, `LogPage.ts` and `ServiceRow.ts` written.

- [ ] **Step 7: Confirm partition pruning is actually happening**

Run:

```bash
mysql iknos -e "EXPLAIN SELECT id FROM log_entry WHERE ts >= '2026-08-09 00:00:00' AND ts < '2026-08-10 00:00:00'\G" | grep -i partitions
```

Expected: a single named partition, not a comma-separated list of all of them. If every partition is listed, the range predicate is not pruning and the query plan needs fixing before this ships.

- [ ] **Step 8: Commit**

```bash
git add crates/ web/src/types Cargo.lock
git commit -m "feat(api): logs search with keyset pagination"
```

---

## Task 21: Live tail over SSE

**Files:**
- Create: `crates/iknos-api/src/stream.rs`, `crates/iknos-api/tests/stream.rs`
- Modify: `crates/iknos-api/src/lib.rs`

**Interfaces:**
- Produces: `GET /api/logs/stream`, emitting `data:` frames whose payload is a `LogRow` JSON object — the same shape `GET /api/logs` returns, so the front end has one row renderer.

- [ ] **Step 1: Write the failing test**

`crates/iknos-api/tests/stream.rs`:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use tower::ServiceExt;

mod common;
use common::test_app_with_state;

#[tokio::test]
async fn the_stream_requires_a_session() {
    let (app, _, _) = test_app_with_state().await;
    let res = app
        .oneshot(
            Request::builder()
                .uri("/api/logs/stream?from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "SSE must not be a back door");
}

#[tokio::test]
async fn the_stream_also_requires_a_time_range() {
    let (app, cookie, _) = test_app_with_state().await;
    let res = app
        .oneshot(
            Request::builder()
                .uri("/api/logs/stream")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_published_record_reaches_a_subscriber_and_respects_filters() {
    use futures::StreamExt;
    use http_body_util::BodyExt;

    let (app, cookie, state) = test_app_with_state().await;

    let res = app
        .oneshot(
            Request::builder()
                .uri("/api/logs/stream?from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z&service=wanted")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CONTENT_TYPE).unwrap(),
        "text/event-stream"
    );

    // Publish one record that must be filtered out, then one that must arrive.
    let mut ignored = common::sample_record("unwanted", "should not appear");
    ignored.service = "unwanted".into();
    let _ = state.live.send(ignored);
    let _ = state.live.send(common::sample_record("wanted", "should appear"));

    let mut body = res.into_body().into_data_stream();
    let mut text = String::new();
    while let Ok(Some(Ok(chunk))) =
        tokio::time::timeout(std::time::Duration::from_secs(3), body.next()).await
    {
        text.push_str(&String::from_utf8_lossy(&chunk));
        if text.contains("should appear") {
            break;
        }
    }

    assert!(text.contains("should appear"), "got: {text}");
    assert!(!text.contains("should not appear"), "filter leaked: {text}");
}
```

Extend `tests/common/mod.rs` with `test_app_with_state()` returning `(Router, cookie, AppState)` and `sample_record(service, message) -> LogRecord`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-api --test stream`
Expected: FAIL — `/api/logs/stream` returns 404.

- [ ] **Step 3: Implement the handler**

Run `cargo add -p iknos-api tokio-stream --features sync && cargo add -p iknos-api futures && cargo add -p iknos-api http-body-util --dev`.

`crates/iknos-api/src/stream.rs`:

```rust
use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use chrono::{DateTime, Utc};
use futures::stream::Stream;
use iknos_core::{AppError, LogRecord};
use serde::Deserialize;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

use crate::AppState;
use crate::auth::layer::CurrentSession;
use crate::logs::LogRow;

#[derive(Deserialize, Clone)]
pub struct StreamParams {
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub service: Option<String>,
    pub min_level: Option<i16>,
    pub q: Option<String>,
}

fn matches(r: &LogRecord, p: &StreamParams) -> bool {
    if let Some(s) = &p.service {
        if &r.service != s {
            return false;
        }
    }
    if let Some(l) = p.min_level {
        if r.level < l {
            return false;
        }
    }
    if let Some(q) = &p.q {
        if !q.is_empty() && !r.message.contains(q.as_str()) {
            return false;
        }
    }
    true
}

fn to_row(r: &LogRecord) -> LogRow {
    LogRow {
        // Live rows have no database id yet; the client keys on ts + message.
        id: String::new(),
        ts: r.ts.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        service: r.service.clone(),
        level: r.level,
        level_name: r.level_name.clone(),
        message: r.message.clone(),
        trace_id: r.trace_id.clone(),
        route: r.route.clone(),
        status_code: r.status_code,
        duration_ms: r.duration_ms,
    }
}

pub async fn stream(
    State(state): State<AppState>,
    CurrentSession(_): CurrentSession,
    Query(p): Query<StreamParams>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    // Same rule as the search endpoint, so the UI can share one query builder.
    if p.from.is_none() || p.to.is_none() {
        return Err(AppError::BadRequest(
            "both 'from' and 'to' are required".into(),
        ));
    }

    let rx = state.live.subscribe();

    let stream = BroadcastStream::new(rx).filter_map(move |item| match item {
        Ok(record) if matches(&record, &p) => {
            let row = to_row(&record);
            serde_json::to_string(&row)
                .ok()
                .map(|json| Ok(Event::default().event("log").data(json)))
        }
        Ok(_) => None,
        // Lagged means this subscriber fell behind and the channel dropped
        // messages for it. Tell the client so it can show a gap marker, and
        // keep the stream alive rather than disconnecting.
        Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
            Some(Ok(Event::default().event("lagged").data(n.to_string())))
        }
    });

    // The keep-alive comment is what stops nginx's read timeout from closing an
    // idle stream. proxy_buffering must also be off — see Task 26.
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}
```

Add `.route("/api/logs/stream", get(stream::stream))` to the `protected` router.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-api --test stream`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify a slow consumer cannot stall ingestion**

Run with the server up and a session cookie in `$C`:

```bash
curl -sN -H "Cookie: $C" "localhost:4310/api/logs/stream?from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z" > /dev/null &
for i in $(seq 1 20000); do echo "{\"@timestamp\":\"2026-08-09T10:00:00.000Z\",\"log.level\":\"info\",\"message\":\"burst $i\"}"; done >> /tmp/iknos-demo-out.log
sleep 10 && mysql iknos -e "SELECT COUNT(*) FROM log_entry WHERE message LIKE 'burst %'"
```

Expected: the count reaches 20000. The subscriber may report `lagged` events — that is the design working, not a fault.

- [ ] **Step 6: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(api): live tail over server-sent events"
```

---

## Task 22: Partition maintenance and retention

**Files:**
- Create: `crates/iknos-store/src/maintenance.rs`, `crates/iknos-store/tests/maintenance.rs`
- Modify: `crates/iknos-store/src/lib.rs`, `crates/iknos-server/src/main.rs`

**Interfaces:**
- Produces: `iknos_store::maintenance::{plan, run}` where `plan(existing: &[String], today: NaiveDate, retention_days: u32, days_ahead: u32) -> Plan` is pure, and `run(pool, today, retention_days) -> anyhow::Result<Report>` executes it.

The planning is a pure function over partition names so the date arithmetic — the part that is actually easy to get wrong — is tested without a database.

- [ ] **Step 1: Write the failing test**

At the bottom of `crates/iknos-store/src/maintenance.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn creates_the_window_ahead_when_none_exists() {
        let p = plan(&[], d("2026-08-09"), 14, 3);
        assert_eq!(p.to_create, vec!["p20260809", "p20260810", "p20260811"]);
        assert!(p.to_drop.is_empty());
    }

    #[test]
    fn only_creates_what_is_missing() {
        let existing = vec!["p20260809".to_string(), "p20260810".to_string()];
        let p = plan(&existing, d("2026-08-09"), 14, 3);
        assert_eq!(p.to_create, vec!["p20260811"]);
    }

    #[test]
    fn drops_partitions_past_the_retention_window() {
        let existing = vec![
            "p20260725".to_string(), // 15 days old — out
            "p20260726".to_string(), // 14 days old — out (boundary)
            "p20260727".to_string(), // 13 days old — kept
            "p20260809".to_string(),
        ];
        let p = plan(&existing, d("2026-08-09"), 14, 3);
        assert_eq!(p.to_drop, vec!["p20260725", "p20260726"]);
    }

    #[test]
    fn never_drops_the_future_partition() {
        let existing = vec!["p_future".to_string(), "p20260101".to_string()];
        let p = plan(&existing, d("2026-08-09"), 14, 3);
        assert!(!p.to_drop.contains(&"p_future".to_string()), "p_future must survive");
        assert_eq!(p.to_drop, vec!["p20260101"]);
    }

    #[test]
    fn ignores_partition_names_it_does_not_recognise() {
        let existing = vec!["p_future".to_string(), "something_else".to_string()];
        let p = plan(&existing, d("2026-08-09"), 14, 3);
        assert!(p.to_drop.is_empty(), "an unknown name is left alone, never dropped");
    }

    #[test]
    fn catches_up_after_a_long_outage_without_creating_the_past() {
        // Gone for a month: we still only build the window from today forward.
        let p = plan(&[], d("2026-09-09"), 14, 3);
        assert_eq!(p.to_create, vec!["p20260909", "p20260910", "p20260911"]);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p iknos-store maintenance`
Expected: FAIL — `cannot find function 'plan'`.

- [ ] **Step 3: Implement planning and execution**

At the top of `crates/iknos-store/src/maintenance.rs`:

```rust
use chrono::{Duration, NaiveDate, Utc};
use sqlx::MySqlPool;

pub const FUTURE_PARTITION: &str = "p_future";

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub to_create: Vec<String>,
    pub to_drop: Vec<String>,
}

#[derive(Debug, Default)]
pub struct Report {
    pub created: Vec<String>,
    pub dropped: Vec<String>,
}

fn partition_name(date: NaiveDate) -> String {
    format!("p{}", date.format("%Y%m%d"))
}

fn date_of(name: &str) -> Option<NaiveDate> {
    let digits = name.strip_prefix('p')?;
    NaiveDate::parse_from_str(digits, "%Y%m%d").ok()
}

pub fn plan(
    existing: &[String],
    today: NaiveDate,
    retention_days: u32,
    days_ahead: u32,
) -> Plan {
    let mut to_create = Vec::new();
    for offset in 0..days_ahead as i64 {
        let name = partition_name(today + Duration::days(offset));
        if !existing.iter().any(|e| e == &name) {
            to_create.push(name);
        }
    }

    let cutoff = today - Duration::days(retention_days as i64);
    let to_drop = existing
        .iter()
        .filter(|name| name.as_str() != FUTURE_PARTITION)
        // An unrecognised name yields None and is therefore never dropped.
        .filter(|name| date_of(name).is_some_and(|d| d <= cutoff))
        .cloned()
        .collect();

    Plan { to_create, to_drop }
}

pub async fn run(pool: &MySqlPool, retention_days: u32) -> anyhow::Result<Report> {
    let existing: Vec<String> = sqlx::query_scalar(
        "SELECT PARTITION_NAME FROM information_schema.PARTITIONS \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'log_entry' \
           AND PARTITION_NAME IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;

    let today = Utc::now().date_naive();
    let p = plan(&existing, today, retention_days, 3);
    let mut report = Report::default();

    // DDL cannot be parameterised. Every name here is derived from a chrono date
    // or matched against %Y%m%d, never from user input.
    for name in &p.to_create {
        let date = date_of(name).expect("generated names always parse");
        let boundary = date + Duration::days(1);
        let sql = format!(
            "ALTER TABLE log_entry REORGANIZE PARTITION {FUTURE_PARTITION} INTO (\
               PARTITION {name} VALUES LESS THAN (TO_DAYS('{}')), \
               PARTITION {FUTURE_PARTITION} VALUES LESS THAN MAXVALUE)",
            boundary.format("%Y-%m-%d")
        );
        sqlx::query(&sql).execute(pool).await?;
        report.created.push(name.clone());
    }

    for name in &p.to_drop {
        // Instant, and it returns the space to the filesystem — the thing a
        // batched DELETE could never do.
        let sql = format!("ALTER TABLE log_entry DROP PARTITION {name}");
        sqlx::query(&sql).execute(pool).await?;
        report.dropped.push(name.clone());
    }

    tracing::info!(
        created = report.created.len(),
        dropped = report.dropped.len(),
        "partition maintenance complete"
    );
    Ok(report)
}
```

Add `pub mod maintenance;` to `crates/iknos-store/src/lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p iknos-store maintenance`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the integration test**

`crates/iknos-store/tests/maintenance.rs`:

```rust
#[tokio::test]
async fn creating_the_window_is_idempotent_and_leaves_the_table_writable() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = iknos_store::connect(&url, 4).await.unwrap();

    let first = iknos_store::maintenance::run(&pool, 14).await.unwrap();
    let second = iknos_store::maintenance::run(&pool, 14).await.unwrap();

    assert!(!first.created.is_empty(), "the first run should build the window");
    assert!(second.created.is_empty(), "the second run must be a no-op");

    // Inserting today still works after reorganising.
    sqlx::query(
        "INSERT INTO log_entry (ts, service, level, level_name, message) \
         VALUES (CURRENT_TIMESTAMP(3), 'maint-test', 30, 'info', 'after reorganise')",
    )
    .execute(&pool)
    .await
    .expect("insert must still succeed after partition maintenance");
}
```

- [ ] **Step 6: Schedule it in the server**

In `serve()` in `crates/iknos-server/src/main.rs`:

```rust
    let maint_pool = pool.clone();
    let retention_days = config.retention_days;
    iknos_core::supervisor::spawn_supervised("maintenance", shutdown.clone(), move || {
        let pool = maint_pool.clone();
        async move {
            // Once at startup so a fresh deploy is immediately correct, then daily.
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(24 * 60 * 60));
            loop {
                ticker.tick().await;
                iknos_store::maintenance::run(&pool, retention_days).await?;
            }
        }
    });
```

`tokio::time::interval` fires immediately on its first tick, which is exactly the startup run we want.

- [ ] **Step 7: Run the tests and verify on disk**

Run: `cargo test -p iknos-store`
Expected: PASS.

Then confirm the space claim rather than trusting it:

```bash
mysql iknos -e "SELECT PARTITION_NAME, TABLE_ROWS, DATA_LENGTH FROM information_schema.PARTITIONS WHERE TABLE_NAME='log_entry'"
```

Expected: one row per day plus `p_future`, with sizes that drop to nothing after a partition is dropped.

- [ ] **Step 8: Commit**

```bash
git add crates/ Cargo.lock
git commit -m "feat(store): daily partition window and retention"
```

---

## Task 23: Next app and design system port

**Files:**
- Create: `web/` (Next App Router project), `web/src/app/layout.tsx`, `web/src/styles/*`, `web/src/lib/api.ts`, `web/src/components/*`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `web/src/lib/api.ts` exporting `apiGet<T>(path: string): Promise<T>` for server components (forwards the incoming cookie) and `apiMutate(path, body)` for client components (attaches the CSRF header). Tasks 24, 25 and 26 use only these two.

- [ ] **Step 1: Scaffold the app**

Run:

```bash
pnpm create next-app@latest web --ts --app --tailwind --eslint=false --src-dir --import-alias '@/*'
```

Then remove the generated boilerplate page and CSS so nothing from the template survives into the design system port.

- [ ] **Step 2: Port the design system from PFA**

Copy from the PFA repo into `web/src/styles/`: the `globals.css` split, the token files (colours, spacing, radii, typography, scales), the font setup, and the background and grain layers. Then rename the prefix in one pass:

```bash
cd web && grep -rl 'pfa-' src | xargs sed -i '' 's/pfa-/ikn-/g' && grep -rn 'pfa-' src | wc -l
```

Expected: `0`. On Linux drop the `''` after `-i`.

This is a fork, not a link. From here the two design systems evolve separately.

- [ ] **Step 3: Port only the components M1 needs**

From PFA: `GlowCard` (with its gradient and border rule), buttons, text fields, selects, the table primitive, the status badge/pill, tooltip, and the time-range picker with its `nuqs` URL state. Leave the dataviz primitives — M1 has no charts, and porting them now would be dead code.

Keep the original rules: no arbitrary Tailwind values, everything snapped to tokens. Brackets are for structural values only.

- [ ] **Step 4: Write the API client**

`web/src/lib/api.ts`:

```ts
const API_BASE = process.env.IKNOS_API_BASE ?? "http://127.0.0.1:4310";

/** Server components only: forwards the caller's session cookie to Rust. */
export async function apiGet<T>(path: string): Promise<T> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { cookie: header },
    // Log data is never stale-cacheable.
    cache: "no-store",
  });

  if (res.status === 401) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  if (!res.ok) throw new Error(`api ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Client components: same-origin, so the browser sends the cookie itself. */
export async function apiMutate(path: string, body?: unknown): Promise<Response> {
  const csrf = await fetch("/api/csrf", { credentials: "same-origin" })
    .then((r) => r.json())
    .then((j) => j.csrf_token as string);

  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
```

Client-side calls use relative paths so they hit nginx on the same origin — that is what makes the cookie and CSRF header work without any CORS configuration.

- [ ] **Step 5: Add the app chrome**

`web/src/app/layout.tsx` with the sidebar or header carrying four entries — Overview, Logs, Issues, Alerts. Only Logs is reachable in M1; the other three render a "coming in M2" placeholder rather than a dead link, so the navigation does not have to change shape later.

- [ ] **Step 6: Verify**

Run: `cd web && pnpm build`
Expected: build succeeds, no `pfa-` remaining, type check clean against the generated declarations in `web/src/types/`.

- [ ] **Step 7: Commit**

```bash
git add web/ .gitignore
git commit -m "feat(web): next app with the PFA design system ported"
```

---

## Task 24: Login page and route protection

**Files:**
- Create: `web/src/app/login/page.tsx`, `web/src/app/login/login-form.tsx`, `web/src/middleware.ts`

**Interfaces:**
- Produces: a working login flow. Every later page can assume a session exists by the time it renders.

- [ ] **Step 1: Write the middleware**

`web/src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

// Next middleware runs on the Edge runtime, where no Redis client works. So it
// only checks that a cookie is PRESENT and redirects if not. Whether the session
// is valid is decided by Rust on every single call — this is a UX shortcut, not
// a security boundary.
export function middleware(req: NextRequest) {
  if (req.cookies.has("iknos.sid")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
```

The comment is load-bearing. Someone will eventually be tempted to "finish" this middleware by validating the session here; it cannot be done on Edge, and it does not need to be.

- [ ] **Step 2: Write the form**

`web/src/app/login/login-form.tsx` — a client component with email and password fields posting to `/api/auth/login` with `credentials: "same-origin"`. Login is the one route with no CSRF token, because there is no session yet to mint one from; `SameSite=Lax` is what protects it.

Handle exactly three response cases:

```tsx
if (res.status === 429) {
  setError("Trop de tentatives. Réessayez dans une minute.");
} else if (!res.ok) {
  // Deliberately identical for unknown account and wrong password.
  setError("Identifiants invalides.");
} else {
  router.replace("/logs");
}
```

- [ ] **Step 3: Verify the three states by hand**

Run the stack, then in the browser: submit empty (client validation blocks), submit wrong credentials (generic message), submit six times fast (the 429 message), then submit correct credentials (redirect to `/logs`).

In devtools, confirm the `iknos.sid` cookie shows `HttpOnly`, `Secure` and `SameSite=Lax`. `Secure` requires HTTPS, so this check happens against the deployed environment in Task 27, not against `localhost`.

- [ ] **Step 4: Commit**

```bash
git add web/
git commit -m "feat(web): login page and cookie-presence middleware"
```

---

## Task 25: Logs page — search, filters and pagination

**Files:**
- Create: `web/src/app/logs/page.tsx`, `web/src/app/logs/filters.tsx`, `web/src/app/logs/log-table.tsx`, `web/src/app/logs/log-row.tsx`, `web/src/lib/log-query.ts`

**Interfaces:**
- Produces: `web/src/lib/log-query.ts` exporting `buildLogQuery(params: URLSearchParams): string` — the single place that turns UI state into an API query string. Task 26 reuses it for the SSE URL, so search and live tail can never drift apart.

- [ ] **Step 1: Write the query builder with its test**

`web/src/lib/log-query.ts`:

```ts
export type Range = "15m" | "1h" | "24h" | "7d";

export function resolveRange(range: Range, now = new Date()): { from: string; to: string } {
  const minutes: Record<Range, number> = { "15m": 15, "1h": 60, "24h": 1440, "7d": 10080 };
  const from = new Date(now.getTime() - minutes[range] * 60_000);
  return { from: from.toISOString(), to: now.toISOString() };
}

/**
 * The only place UI state becomes an API query. `from` and `to` are always
 * present — the API rejects a request without them, so the UI must never be
 * able to build one.
 */
export function buildLogQuery(params: URLSearchParams, now = new Date()): string {
  const range = (params.get("range") as Range) ?? "1h";
  const { from, to } = resolveRange(range, now);

  const out = new URLSearchParams({ from, to });
  for (const key of ["service", "min_level", "route", "status_code", "q", "cursor"]) {
    const value = params.get(key);
    if (value) out.set(key, value);
  }
  return out.toString();
}
```

`web/src/lib/log-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLogQuery } from "./log-query";

describe("buildLogQuery", () => {
  it("always emits from and to", () => {
    const q = new URLSearchParams(buildLogQuery(new URLSearchParams()));
    expect(q.get("from")).toBeTruthy();
    expect(q.get("to")).toBeTruthy();
  });

  it("passes through the filters that are set and omits the ones that are not", () => {
    const q = new URLSearchParams(
      buildLogQuery(new URLSearchParams({ service: "pfa-api", q: "/api/users/42" })),
    );
    expect(q.get("service")).toBe("pfa-api");
    expect(q.get("q")).toBe("/api/users/42");
    expect(q.has("route")).toBe(false);
  });

  it("honours the selected range", () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    const q = new URLSearchParams(buildLogQuery(new URLSearchParams({ range: "24h" }), now));
    expect(q.get("from")).toBe("2026-08-08T12:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then passes**

Run: `cd web && pnpm vitest run src/lib/log-query.test.ts`
Expected: FAIL first (module not found), PASS after Step 1's implementation is in place.

- [ ] **Step 3: Build the page**

`web/src/app/logs/page.tsx` — a server component reading `searchParams`, calling `apiGet<LogPage>(\`/api/logs?${buildLogQuery(params)}\`)`, rendering `<Filters />` and `<LogTable />`. Import `LogPage` and `LogRow` from `@/types/`, never redeclared by hand.

`filters.tsx` — a client component holding service, minimum level, route, status, free text and range, with all state in the URL via `nuqs`. A shared, reloadable search falls out of that for free.

`log-table.tsx` — dense rows: timestamp, service, level badge, message. Clicking a row expands the full record including `attrs`. Clicking a `trace_id` sets `q` to that id and clears the other filters, which is the move that turns one line into the whole request.

- [ ] **Step 4: Wire up pagination**

Load-more, not numbered pages: `next_cursor` from the previous response goes into the next request. Append rows to the existing list rather than replacing them.

Because the cursor is keyset rather than an offset, new rows arriving during paging cannot shift the window and cause a duplicate or a skip.

- [ ] **Step 5: Verify**

With ingestion running, confirm: every filter combines and survives a reload; a `trace_id` click reconstructs the request; load-more reaches the end without a repeated row; 10 000 loaded rows still scroll smoothly.

- [ ] **Step 6: Commit**

```bash
git add web/
git commit -m "feat(web): logs page with filters and cursor pagination"
```

---

## Task 26: Logs page — live tail

**Files:**
- Create: `web/src/app/logs/live-tail.tsx`, `web/src/hooks/use-log-stream.ts`

**Interfaces:**
- Produces: `useLogStream(query: string, enabled: boolean)` returning `{ rows: LogRow[]; gaps: number; connected: boolean }`.

- [ ] **Step 1: Write the hook**

`web/src/hooks/use-log-stream.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { LogRow } from "@/types/LogRow";

/** A tab left open overnight must not accumulate a gigabyte of rows. */
const MAX_BUFFERED_ROWS = 2000;

export function useLogStream(query: string, enabled: boolean) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [gaps, setGaps] = useState(0);
  const [connected, setConnected] = useState(false);
  const paused = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    const source = new EventSource(`/api/logs/stream?${query}`);

    source.onopen = () => setConnected(true);

    source.addEventListener("log", (e) => {
      if (paused.current) return;
      const row = JSON.parse((e as MessageEvent).data) as LogRow;
      setRows((prev) => {
        const next = [row, ...prev];
        // Trim from the tail, so the newest rows are the ones retained.
        return next.length > MAX_BUFFERED_ROWS ? next.slice(0, MAX_BUFFERED_ROWS) : next;
      });
    });

    // The server sends this when this subscriber fell behind and the broadcast
    // channel dropped messages for it. Surfacing it is honest; hiding it would
    // make the list silently wrong.
    source.addEventListener("lagged", () => setGaps((g) => g + 1));

    source.onerror = () => {
      // EventSource reconnects on its own; we only reflect the state.
      setConnected(false);
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [query, enabled]);

  return { rows, gaps, connected, pause: paused };
}
```

- [ ] **Step 2: Build the component**

`web/src/app/logs/live-tail.tsx` — a client component with a start/stop toggle. It builds its query with the same `buildLogQuery` the search page uses, so the two views cannot diverge.

Pause on scroll: when the user scrolls away from the top of the list, set `paused.current = true` and show a "N nouvelles lignes" button that resumes and jumps back. A list that jumps while you are reading it is unusable, and this is the whole difference between a live tail people use and one they turn off.

Render a visible marker whenever `gaps` increases, and a connection indicator driven by `connected`.

- [ ] **Step 3: Verify the hard cases**

- A line appended to a PM2 log file appears within 2 seconds.
- Scrolling down pauses; the resume button restores the flow.
- Restarting the Rust process shows a disconnect, then reconnects on its own with a gap marker.
- Leave the tab open 8 hours under real traffic and confirm browser memory is flat. This is what `MAX_BUFFERED_ROWS` exists for; if memory climbs, the trim is not running.

- [ ] **Step 4: Commit**

```bash
git add web/
git commit -m "feat(web): live tail with pause-on-scroll and gap markers"
```

---

## Task 27: Deployment

**Files:**
- Create: `deploy/ecosystem.config.js`, `deploy/nginx.conf`, `deploy/deploy.sh`, `README.md`

**Interfaces:**
- Produces: a deployed Iknos on its subdomain, and a one-command deploy.

The binary is built on **vps-debian** and moved to **ks-b**. Neither the Mac (wrong OS entirely) nor ks-b (whose RAM is better spent running things) compiles anything.

- [ ] **Step 1: Confirm the two machines agree**

Run on both vps-debian and ks-b:

```bash
uname -m && ldd --version | head -1
```

The architectures must match. The glibc versions do not need to, because of the next step.

- [ ] **Step 2: Set up the musl toolchain on vps-debian**

Run on vps-debian:

```bash
rustup target add x86_64-unknown-linux-musl && sudo apt install -y musl-tools
```

Building against musl produces a fully static binary, so ks-b's glibc version stops mattering — now and after any future upgrade of either machine. This works cleanly because with `rustls` rather than OpenSSL nothing in the dependency tree needs a C toolchain.

If `uname -m` returned `aarch64`, substitute `aarch64-unknown-linux-musl` throughout.

- [ ] **Step 3: Write the deploy script**

`deploy/deploy.sh` — run from the Mac. Routing the artifact through your laptop avoids needing SSH keys between the two servers.

```bash
#!/usr/bin/env bash
set -euo pipefail

BUILD_HOST="vps-debian"
TARGET_HOST="ks-b"
TARGET="x86_64-unknown-linux-musl"
BUILD_DIR="~/build/iknos"
REMOTE_DIR="/opt/iknos"

echo "==> building on ${BUILD_HOST}"
ssh "$BUILD_HOST" "cd ${BUILD_DIR} && git pull --ff-only && cargo build --release --target ${TARGET}"

echo "==> fetching the binary"
TMP=$(mktemp -d)
scp "${BUILD_HOST}:${BUILD_DIR}/target/${TARGET}/release/iknos" "${TMP}/iknos"

echo "==> shipping to ${TARGET_HOST}"
scp "${TMP}/iknos" "${TARGET_HOST}:${REMOTE_DIR}/iknos.new"

# `mv` is a rename: atomic, and it works even though the old binary is running.
# `cp` would fail with ETXTBSY. Keeping the previous binary makes rollback a
# single command.
ssh "$TARGET_HOST" "
  cd ${REMOTE_DIR} &&
  cp -f iknos iknos.previous 2>/dev/null || true &&
  mv iknos.new iknos &&
  chmod +x iknos &&
  pm2 reload iknos
"

echo "==> deploying the front end"
ssh "$TARGET_HOST" "cd ${REMOTE_DIR}/web && git pull --ff-only && pnpm install --frozen-lockfile && pnpm build && pm2 reload iknos-web"

rm -rf "$TMP"
echo "==> done. Migrations are NOT run by this script."
```

The last line is not a nicety. Migrations stay manual, over SSH, exactly as with PFA:

```bash
ssh ks-b 'cd /opt/iknos && sqlx migrate run'
```

Rollback:

```bash
ssh ks-b 'cd /opt/iknos && mv iknos.previous iknos && pm2 reload iknos'
```

- [ ] **Step 4: Write the PM2 ecosystem file**

`deploy/ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: "iknos",
      script: "/opt/iknos/iknos",
      // Without this PM2 tries to hand the binary to Node and it fails to start.
      interpreter: "none",
      cwd: "/opt/iknos",
      env_file: "/opt/iknos/.env",
      // The Rust side drains on SIGTERM; give it room before SIGKILL.
      kill_timeout: 10000,
      max_restarts: 10,
    },
    {
      name: "iknos-web",
      script: "pnpm",
      args: "start",
      cwd: "/opt/iknos/web",
      env: { PORT: "4311", IKNOS_API_BASE: "http://127.0.0.1:4310" },
    },
  ],
};
```

- [ ] **Step 5: Write the nginx site**

`deploy/nginx.conf`:

```nginx
server {
  listen 443 ssl http2;
  server_name iknos.YOUR_DOMAIN;

  # TLS via certbot

  location /health {
    proxy_pass http://127.0.0.1:4310;
  }

  # SSE needs its own block, before the general /api/ one.
  location /api/logs/stream {
    proxy_pass http://127.0.0.1:4310;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    # Without this nginx buffers the stream and "live" arrives in clumps every
    # few seconds. This is the line everyone forgets.
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:4310;
    proxy_set_header Host $host;
    # The login rate limiter keys on this. Without it every request appears to
    # come from 127.0.0.1 and the first five failures lock out everybody.
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location / {
    proxy_pass http://127.0.0.1:4311;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

One subdomain, so the browser stays on one origin and the session cookie and CSRF header work with no CORS configuration at all.

- [ ] **Step 6: First deploy**

```bash
ssh ks-b 'mkdir -p /opt/iknos && chmod 700 /opt/iknos'
# Write /opt/iknos/.env with the real secrets, then:
ssh ks-b 'chmod 600 /opt/iknos/.env'
./deploy/deploy.sh
ssh ks-b 'cd /opt/iknos && sqlx migrate run'
ssh ks-b 'cd /opt/iknos && ./iknos user create you@yourdomain'
ssh ks-b 'pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup'
```

- [ ] **Step 7: Verify the deployment against the milestone's criteria**

```bash
curl -si https://iknos.YOUR_DOMAIN/api/me | head -1          # expect 401
curl -si https://iknos.YOUR_DOMAIN/health | head -1          # expect 200
```

Then in a browser: log in, confirm in devtools that the cookie carries `HttpOnly`, `Secure` and `SameSite=Lax` (only observable over real HTTPS), open the Logs page, and confirm a line written by any PM2 app on ks-b appears within 2 seconds.

Reboot the machine and confirm both processes come back. Record the RSS of both after 24 hours in the README — the spec claims roughly 10–15 MB for the Rust process, and it is worth knowing whether that held.

- [ ] **Step 8: Write the README**

Installation (Rust toolchain, sqlx-cli, musl target), the environment variables, local commands, the deploy and rollback commands, the manual migration step, and the measured steady-state database size.

- [ ] **Step 9: Commit**

```bash
git add deploy/ README.md
git commit -m "feat(deploy): pm2, nginx and cross-machine binary deployment"
```

---

## Self-Review

**Spec coverage.** Every section of the design doc maps to a task: §3 architecture → Tasks 1, 8, 9, 19; §4 data model → Tasks 2, 3, 4, 22; §5 ingestion → Tasks 15–19; §6 API and auth → Tasks 9–14, 20, 21; §7 the Next seam → Tasks 20, 23, 25; §8 deployment → Task 27; §9 testing → distributed through every task rather than gathered at the end.

Two spec items are deliberately deferred with a note rather than silently dropped:
- The dataviz primitives from `IKN-5` are not ported in Task 23. M1 has no charts; porting them now would be dead code. They arrive with `IKN-13`.
- `iknos-core/src/supervisor.rs` is used by the tailer and maintenance tasks but not by the axum server, which has its own graceful-shutdown path. That asymmetry is intentional — axum's `with_graceful_shutdown` already does the job.

**Known ordering constraint.** Task 13's first test asserts a non-200 status for `/api/services` and `/api/logs` before Tasks 20 mounts them. Tighten that assertion to `UNAUTHORIZED` once Task 20 lands; the plan says so at the step.

**Values to fill in from your environment.** Three literals in the plan are placeholders for values only your machines can supply, and each is called out at the step that needs it: the epoch-millis constant in Task 16's first parser test, the real `DUMMY_HASH` PHC string in Task 13, and `YOUR_DOMAIN` in Task 27. These are environment facts, not undecided design.

