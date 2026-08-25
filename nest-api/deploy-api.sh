#!/usr/bin/env bash
set -Eeuo pipefail

# Deploys the Iknos API. Same shape as Zeus, spira and pfa: rsync into a fresh release
# directory, atomic switch keeping the previous version as a backup, install and build on the
# server, pm2 reload, verify /health, with automatic rollback if anything fails after the switch.
#
# **This script migrates**, between the build and the pm2 reload — see apply_migrations. That is
# what Zeus, spira and trekker all do, and the position is the point: the schema is in place
# before the new code is ever served. A migration that fails stops the deploy there and the ERR
# trap restores the previous release, so the code that ends up serving is never the code whose
# schema did not land.
#
# It did not always. This was copied from pfa, the one API in the fleet whose deploy script does
# not mention Prisma, and the header used to argue the case for that: restoring a release is a
# directory swap, Prisma has no down-migration, so migrating and then rolling back leaves the old
# code in front of the new schema. The hazard is real and has not gone away — trekker's script
# names the same one and migrates anyway — but the alternative was worse. `DATABASE_URL` answers
# on ks-b's loopback and nowhere else, and a new migration file only reaches the server *by this
# script*, so "migrate first, then deploy" was never available: the order is necessarily deploy
# then migrate. Leaving the second half to a human meant every deploy shipped code against
# whatever schema happened to be there, silently, and the header promised a
# `check_pending_migrations` that was never written (IKN-50).
#
# What is left of the hazard is handled where it actually bites: MySQL DDL is not transactional,
# so apply_migrations aborts loudly with `prisma migrate status` and `migrate resolve` rather than
# pretending a part-applied schema can be swept up by a directory swap. Rolling *back* across a
# migration is still a decision about data, and still a person's.
#
# Usage: ./deploy-api.sh [deploy|rollback]

######################################
# Configuration
######################################
REMOTE_USER_HOST="debian@ks-b"

API_ROOT="/var/www/iknos"
NEST_DIR="$API_ROOT/nest-api"
NEST_BACKUP_DIR="$API_ROOT/nest-api.bak"
NEST_RELEASES_DIR="$API_ROOT/nest-api-releases"

# The pm2 config on ks-b. **This is the production environment** — there is no `.env` on the
# server — and it is the only file there carrying the production `DATABASE_URL`, which is what
# the migration step connects with.
ECOSYSTEM_REMOTE="$API_ROOT/ecosystem.config.js"

# Which entry to read inside it. Also the pm2 process name and Iknos's row in Zeus's registry:
# renaming it is load-bearing in three places, not one.
PM2_APP_NAME="iknos-api"

API_PORT="6900"

# The branch a deploy is allowed to ship. The tree must be clean and level with it.
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

# PATH additions for a non-interactive ssh session, which does not source the profile. pnpm lives
# under the user, node and pm2 in /usr/local/bin. Checked on ks-b.
REMOTE_PATH="/home/debian/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin:/usr/sbin"

######################################
# Reporting to Zeus
######################################
ZEUS_APP_NAME="${ZEUS_APP_NAME:-iknos}"
ZEUS_ROLE="api"

# Zeus's own ecosystem file on ks-b, which carries the ingest URL and the shared token. Read
# there rather than carried on the laptop: the secret never travels, never lands in this repo,
# and never appears on an ssh command line where `ps` would show it. The endpoint is
# loopback-only, so the POST has to happen on ks-b whatever else is true.
ZEUS_ECOSYSTEM_FILE="${ZEUS_ECOSYSTEM_FILE:-/var/www/zeus/ecosystem.config.js}"
ZEUS_ENV_FILE="${ZEUS_ENV_FILE:-/var/www/zeus/nest-api/.env}"

DEPLOY_LOG_DIR="$API_ROOT/deploy-logs"
DEPLOY_LOG_FILE="$DEPLOY_LOG_DIR/deploys-$ZEUS_ROLE.txt"
DEPLOY_MARKER="$DEPLOY_LOG_DIR/.last-$ZEUS_ROLE"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

######################################
# Utility functions
######################################

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

die() {
  echo "❌ ERROR: $*" >&2
  exit 1
}

# Refuse to ship a tree that is not exactly what is on the remote branch.
#
# rsync copies the working tree as it is, so what deploys is whatever is on this laptop — not what
# is committed and not what is merged. Meanwhile the release directory name, the changelog on the
# server and the deploy report all take their commit from HEAD, so a dirty deploy puts three
# confident labels on the box naming a commit whose content is not what is running.
#
# Runs before any ssh or rsync: the whole point is to fail here, with nothing on the server
# touched.
require_clean_tree() {
  cd "$SCRIPT_DIR"

  local dirty
  dirty=$(git status --porcelain)
  if [ -n "$dirty" ]; then
    echo "❌ ERROR: refusing to deploy — the working tree is not clean:" >&2
    printf '%s\n' "$dirty" >&2
    echo "   commit, stash or clean these first." >&2
    exit 1
  fi

  # Without a fetch, origin/$DEPLOY_BRANCH is whatever this laptop last heard — exactly the stale
  # value that lets a behind-by-one tree deploy. Fatal on purpose: a deploy needs the network
  # anyway, so "cannot reach the remote" is never the moment to guess.
  git fetch --quiet origin "$DEPLOY_BRANCH" \
    || die "could not fetch origin/$DEPLOY_BRANCH to compare against."

  local head remote
  head=$(git rev-parse HEAD)
  remote=$(git rev-parse FETCH_HEAD)

  if [ "$head" != "$remote" ]; then
    echo "❌ ERROR: refusing to deploy — HEAD does not match origin/$DEPLOY_BRANCH:" >&2
    echo "   local  $head" >&2
    echo "   remote $remote" >&2
    echo "   pull, push or check out the right branch first." >&2
    exit 1
  fi
}

# Everything red before the first byte is uploaded. A check that ran after the atomic switch
# would be a rollback trigger rather than a gate.
run_preflight_checks() {
  local names=("lint" "typecheck" "tests" "build")

  # The suite's entry carries two settings the other three do not need, both about what the
  # streamed step actually shows (IKN-43).
  #
  # `--reporter=verbose`: once its output is a pipe rather than a terminal — and this one is
  # piped through `tee` — vitest's default reporter prints the closing summary and nothing else,
  # no test names at all. Streaming a step that says nothing until it is over defeats the reason
  # it is streamed.
  #
  # `IKNOS_LOG_LEVEL=error`: the e2e suites boot the real application, `.env` sets `debug` on this
  # machine, and every request and every maintenance tick then writes its ECS line — hundreds of
  # them, with the test names lost somewhere in between. `error` and not `silent` because
  # env.validation accepts trace|debug|info|warn|error and nothing else, so `silent` would fail
  # the app's own boot in every e2e: a red suite rather than a quiet one. It beats the `.env`
  # because `process.loadEnvFile()` leaves a variable that is already in the environment alone.
  #
  # Set here rather than exported around the loop so that the hint printed on failure — "re-run
  # it on its own with: ${commands[$index]}" — reproduces exactly the run that failed.
  local commands=("pnpm check" "pnpm typecheck" "IKNOS_LOG_LEVEL=error pnpm test --reporter=verbose" "pnpm build")
  local index output

  # `IKNOS_SKIP_TESTS=1 ./deploy-api.sh` ships without running the suite.
  #
  # An escape hatch rather than a deleted gate, and deliberately noisy: the suite currently fails
  # on the development machine for reasons that have nothing to do with what is being shipped, and
  # a gate that cannot be satisfied stops being a gate and becomes a thing people work around
  # permanently. This way the bypass is one variable, visible in the log of every deploy that used
  # it, and the default is still "everything green or nothing moves".
  if [ -n "${IKNOS_SKIP_TESTS:-}" ]; then
    names=("lint" "typecheck" "build")
    commands=("pnpm check" "pnpm typecheck" "pnpm build")
    log "⚠️  IKNOS_SKIP_TESTS set — shipping WITHOUT running the test suite"
  fi

  for index in "${!names[@]}"; do
    log "➡️  Pre-deploy: ${names[$index]}"
    output=$(mktemp)

    # Not left to errexit: the ERR trap installed by deploy() would report a failed deploy
    # upstream before this has said which check failed and why.
    #
    # The suite is streamed where the other checks stay buffered: it runs a minute against real
    # MySQL and Redis, and a silent minute reads as a hang. `tee` keeps the capture, so the
    # failure path below stays identical for every check.
    if [ "${names[$index]}" = "tests" ]; then
      # `pipefail` is set at the top of the script, so the pipeline's status is the suite's, not tee's.
      if ( cd "$SCRIPT_DIR" && eval "${commands[$index]}" ) 2>&1 | tee "$output"; then ok=1; else ok=0; fi
    else
      if ( cd "$SCRIPT_DIR" && eval "${commands[$index]}" ) > "$output" 2>&1; then ok=1; else ok=0; fi
    fi
    if [ "$ok" != 1 ]; then
      echo "--- ${commands[$index]} ---" >&2
      tail -40 "$output" >&2
      echo "---" >&2
      rm -f "$output"
      die "pre-deploy check failed: ${names[$index]}. Nothing was uploaded.
   Re-run it on its own with: ${commands[$index]}"
    fi
    rm -f "$output"
  done

  log "✅ Pre-deploy checks passed"
}

# The commit the previous deploy shipped — the base of this deploy's commit range.
#
# Order: the marker (steady state) → an IKNOS_SINCE override → the newest release folder's hash →
# empty, which both consumers read as "no baseline, fall back to the last ten commits".
#
# Resolved once, before anything writes. write_deploy_log moves the marker at the end of a
# successful deploy, so a second resolution later would return this deploy's own commit and both
# the changelog and the report would come out claiming nothing shipped.
resolve_base_hash() {
  local base
  base=$(ssh "$REMOTE_USER_HOST" "cat '$DEPLOY_MARKER' 2>/dev/null || true" 2>/dev/null || true)
  [ -z "$base" ] && base="${IKNOS_SINCE:-}"
  [ -z "$base" ] && base="${PREV_FROM_SERVER:-}"

  # A hash this checkout does not have is no baseline at all — a shallow clone, or a marker left
  # by a deploy from a branch since rewritten.
  if [ -n "$base" ] && ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    base=""
  fi

  printf '%s' "$base"
}

# The commits this deploy ships, as a JSON array, newest first.
#
# Messages are escaped in awk rather than interpolated into a shell string. `%s` is the subject
# line only, so it cannot contain a newline, and splitting on the first two spaces is exact
# because neither a sha nor an ISO-8601 date contains one.
zeus_commits_json() {
  local -a range

  # A manual rollback restores a release rather than shipping one. Falling through to the
  # last-ten baseline would claim it delivered ten commits it had nothing to do with.
  if [ "${ZEUS_REPORT_COMMITS:-true}" != "true" ]; then
    printf '[]'
    return 0
  fi

  if [ -n "${ZEUS_BASE_HASH:-}" ]; then
    range=("${ZEUS_BASE_HASH}..HEAD")
  else
    range=(-n 10 HEAD)
  fi

  git log --no-merges --pretty=format:'%H %aI %s' "${range[@]}" 2>/dev/null | awk '
    BEGIN { printf "["; first = 1 }
    NF >= 3 {
      sha = $1
      when = $2
      msg = substr($0, length(sha) + length(when) + 3)
      gsub(/\\/, "\\\\", msg)
      gsub(/"/, "\\\"", msg)
      gsub(/\t/, " ", msg)
      if (!first) printf ","
      printf "{\"sha\":\"%s\",\"authoredAt\":\"%s\",\"message\":\"%s\"}", sha, when, msg
      first = 0
    }
    END { printf "]" }'
}

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\t'/ }
  printf '%s' "$s"
}

# Tell Zeus what this deploy did: `zeus_report <success|failed|rolled_back> [summary]`.
#
# Three rules, none optional: reporting must never fail the deploy (every step is `|| true` and
# callers ignore the return value), fire and forget with a 2s timeout and no retries, and the
# payload travels as a FILE — commit messages contain quotes, backticks and `$`.
zeus_report() {
  local status="$1"
  local summary="${2:-}"
  local commits payload remote_payload duration

  commits=$(zeus_commits_json 2>/dev/null || echo "[]")
  duration=$(( ($(date +%s) - ${ZEUS_STARTED_EPOCH:-$(date +%s)}) * 1000 ))
  payload=$(mktemp)
  remote_payload="/tmp/.iknos-deploy-report.$$.json"

  {
    printf '{"app":"%s","role":"%s","status":"%s"' \
      "$(json_escape "$ZEUS_APP_NAME")" "$(json_escape "$ZEUS_ROLE")" "$(json_escape "$status")"
    printf ',"startedAt":"%s","durationMs":%s' "$(json_escape "${ZEUS_STARTED_AT}")" "$duration"
    [ -n "${ZEUS_RELEASE:-}" ] && printf ',"release":"%s"' "$(json_escape "$ZEUS_RELEASE")"
    [ -n "${ZEUS_COMMIT:-}" ] && printf ',"commit":"%s"' "$(json_escape "$ZEUS_COMMIT")"
    [ -n "${ZEUS_BRANCH:-}" ] && printf ',"branch":"%s"' "$(json_escape "$ZEUS_BRANCH")"
    [ -n "$summary" ] && printf ',"summary":"%s"' "$(json_escape "$summary")"
    printf ',"commits":%s}' "$commits"
  } > "$payload"

  scp -q "$payload" "$REMOTE_USER_HOST:$remote_payload" || { rm -f "$payload"; return 0; }
  rm -f "$payload"

  ssh "$REMOTE_USER_HOST" \
    ZEUS_ECOSYSTEM_FILE="$ZEUS_ECOSYSTEM_FILE" \
    ZEUS_ENV_FILE="$ZEUS_ENV_FILE" \
    PAYLOAD="$remote_payload" \
    'bash -s' << 'EOF' || true
set -uo pipefail

cleanup() { rm -f "$PAYLOAD"; }
trap cleanup EXIT

# One setting, looked for in the pm2 ecosystem file first and the .env second. That order is not
# a preference, it is the order Zeus's API resolves them: pm2 injects env_production before Nest
# starts, and dotenv does not overwrite a variable that is already there. Reading the .env alone
# would present a token the API is not validating against the day the two disagree — a 401 on
# every report and no other symptom.
read_setting() {
  local key="$1" value=""

  if [ -f "$ZEUS_ECOSYSTEM_FILE" ]; then
    value=$(sed -n "s/.*${key}: *['\"]\([^'\"]*\)['\"].*/\1/p" "$ZEUS_ECOSYSTEM_FILE" 2>/dev/null | tail -1)
  fi

  if [ -z "$value" ] && [ -f "$ZEUS_ENV_FILE" ]; then
    value=$(sed -n "s/^${key}=//p" "$ZEUS_ENV_FILE" 2>/dev/null | tail -1 | tr -d '\042\047')
  fi

  printf '%s' "$value"
}

url=$(read_setting ZEUS_DEPLOY_INGEST_URL)
token=$(read_setting ZEUS_INGEST_TOKEN)

if [ -z "$url" ] || [ -z "$token" ]; then
  echo "zeus: not reported — ZEUS_DEPLOY_INGEST_URL or ZEUS_INGEST_TOKEN found in neither" \
    "$ZEUS_ECOSYSTEM_FILE nor $ZEUS_ENV_FILE"
  exit 0
fi

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 \
  -X POST "$url" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $token" \
  --data-binary @"$PAYLOAD" || true)

# 202 is the contract. Anything else is worth one line and nothing more — a deploy that shipped
# and could not say so still shipped.
[ "$code" = "202" ] || echo "zeus: report not recorded (HTTP ${code:-none})"
EOF
}

remote_rollback() {
  ssh "$REMOTE_USER_HOST" \
    NEST_DIR="$NEST_DIR" \
    NEST_BACKUP_DIR="$NEST_BACKUP_DIR" \
    API_ROOT="$API_ROOT" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
cd "$API_ROOT"
[ -d "$NEST_BACKUP_DIR" ] || { echo "❌ ERROR: no backup at $NEST_BACKUP_DIR" >&2; exit 1; }
rm -rf "$NEST_DIR"
mv "$NEST_BACKUP_DIR" "$NEST_DIR"
echo "✅ API rollback done (restored from backup)"
EOF
}

# Applies pending migrations on the server, between the build and the pm2 reload — the shape
# Zeus, spira and trekker all use, and the position is the point: the schema is in place before
# the new code is ever served.
#
# `migrate deploy` is the production verb: it applies what is already in the repo and never
# generates, never resets, never prompts.
#
# A failure here happens after the release switch, so it trips the ERR trap: the previous release
# is restored and pm2 is reloaded onto *it*. The new code never serves. What the trap cannot undo
# is the schema — **MySQL DDL is not transactional**, so a migration that failed midway leaves
# the database part-applied and Prisma has no down-migration to walk it back. The restored code
# then faces a schema slightly ahead of it, which is survivable for an added column and is not
# for a renamed table.
#
# That is why this aborts with `migrate status` and `migrate resolve` rather than continuing:
# what happens next is a decision about data, and it belongs to a person.
apply_migrations() {
  ssh "$REMOTE_USER_HOST" \
    NEST_DIR="$NEST_DIR" \
    ECOSYSTEM_REMOTE="$ECOSYSTEM_REMOTE" \
    PM2_APP_NAME="$PM2_APP_NAME" \
    REMOTE_PATH="$REMOTE_PATH" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
export PATH="$REMOTE_PATH:$PATH"
cd "$NEST_DIR"

# The production URL, off the server's own ecosystem file — the same read the build step makes.
# Passed through the environment and never on a command line: it carries the database password
# and `ps` shows arguments.
DATABASE_URL=$(node -p \
  'const c = require(process.env.ECOSYSTEM_REMOTE); const a = (c.apps || []).find(x => x.name === process.env.PM2_APP_NAME); (a && a.env_production && a.env_production.DATABASE_URL) || ""' \
  2>/dev/null || true)
[ -n "$DATABASE_URL" ] || {
  echo "❌ ERROR: no env_production.DATABASE_URL for '$PM2_APP_NAME' in $ECOSYSTEM_REMOTE" >&2
  echo "   Refusing to migrate rather than falling back to a URL that may point elsewhere." >&2
  exit 1
}
export DATABASE_URL

if ! pnpm migrate:deploy; then
  echo "❌ ERROR: prisma migrate deploy failed — pm2 will not be reloaded" >&2
  echo "   MySQL DDL is not transactional, so the schema may be part-applied. Check first:" >&2
  echo "     cd $NEST_DIR && pnpm exec prisma migrate status" >&2
  echo "   A migration recorded as failed blocks every later deploy until it is resolved:" >&2
  echo "     cd $NEST_DIR && pnpm exec prisma migrate resolve --rolled-back <migration_name>" >&2
  exit 1
fi
EOF
}

restart_pm2() {
  ssh "$REMOTE_USER_HOST" \
    API_ROOT="$API_ROOT" \
    REMOTE_PATH="$REMOTE_PATH" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
export PATH="$REMOTE_PATH:$PATH"
cd "$API_ROOT"
command -v pm2 >/dev/null 2>&1 || { echo "❌ ERROR: pm2 not found on the server" >&2; exit 1; }
pm2 startOrReload ecosystem.config.js --env production --update-env
pm2 save
EOF
}

# Fails the deploy if what just shipped cannot answer. A deploy that reports success while the
# API is down is the failure mode this exists to prevent.
verify_health() {
  ssh "$REMOTE_USER_HOST" \
    API_PORT="$API_PORT" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
body=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  body=$(curl -fsS --max-time 5 "http://127.0.0.1:$API_PORT/health" 2>/dev/null || true)
  case "$body" in
    *'"status":"ok"'*)
      echo "✅ health: $body"
      exit 0
      ;;
  esac
  sleep 2
done

if [ -n "$body" ]; then
  echo "❌ ERROR: API answered something unexpected after 20s: $body" >&2
else
  echo "❌ ERROR: API did not answer /health after 20s" >&2
fi
exit 1
EOF
}

# Prepends this deploy's commits (and IKN tickets) to the changelog kept on the server. Always
# called as `write_deploy_log || log ...`: a changelog hiccup must never fail, or roll back, an
# otherwise successful deploy.
write_deploy_log() {
  local FULL_HASH WHEN PREV_HASH TICKETS COMMITS ENTRY_TMP
  local -a RANGE
  FULL_HASH=$(git rev-parse HEAD)
  WHEN=$(date +'%Y-%m-%d %H:%M:%S')

  PREV_HASH="${ZEUS_BASE_HASH:-}"
  if [ -n "$PREV_HASH" ]; then
    RANGE=("${PREV_HASH}..HEAD")
  else
    RANGE=(-n 10 HEAD)
  fi

  # One git-log call captured into a variable: no `| grep -q` on a pipe git may SIGPIPE, which
  # would trip pipefail.
  COMMITS=$(git log --no-merges --pretty=format:'  %h  %ad  %s' --date=short "${RANGE[@]}")
  TICKETS=$(printf '%s\n' "$COMMITS" \
    | grep -oiE 'IKN-[0-9]+' | tr 'a-z' 'A-Z' | sort -t- -k2,2n -u | paste -sd ',' - | sed 's/,/, /g' || true)

  ENTRY_TMP=$(mktemp)
  {
    echo "=== $WHEN · branch $GIT_BRANCH_RAW · deploy $GIT_HASH ==="
    [ -n "$TICKETS" ] && echo "Tickets: $TICKETS"
    [ -z "$PREV_HASH" ] && echo "  (first recorded deploy — baseline: last 10 commits, not full history)"
    if [ -n "$COMMITS" ]; then
      printf '%s\n' "$COMMITS"
    else
      echo "  (no new commit — redeploy of $GIT_HASH)"
    fi
    echo
  } > "$ENTRY_TMP"

  # Commit messages travel as file content over scp, never interpolated into a shell command.
  ssh "$REMOTE_USER_HOST" "mkdir -p '$DEPLOY_LOG_DIR'"
  scp -q "$ENTRY_TMP" "$REMOTE_USER_HOST:$DEPLOY_LOG_DIR/.entry.tmp"
  ssh "$REMOTE_USER_HOST" \
    LOG_DIR="$DEPLOY_LOG_DIR" \
    LOG_FILE="$DEPLOY_LOG_FILE" \
    MARKER="$DEPLOY_MARKER" \
    FULL_HASH="$FULL_HASH" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
touch "$LOG_FILE"
cat "$LOG_DIR/.entry.tmp" "$LOG_FILE" > "$LOG_FILE.new"
mv "$LOG_FILE.new" "$LOG_FILE"
rm -f "$LOG_DIR/.entry.tmp"
printf '%s\n' "$FULL_HASH" > "$MARKER"
EOF
  rm -f "$ENTRY_TMP"
}

deploy() {
  cd "$SCRIPT_DIR"

  # Setup problems before readiness problems: "you have not configured this" is a different kind
  # of failure from "you are not ready to ship", and meeting them one per run is needless.
  [ -f "$SCRIPT_DIR/ecosystem.config.js" ] \
    || die "missing nest-api/ecosystem.config.js — copy ecosystem.config.example.js and fill it in. It is not committed."

  require_clean_tree
  run_preflight_checks

  GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "no-git")
  GIT_BRANCH_RAW=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-branch")
  local GIT_BRANCH=${GIT_BRANCH_RAW//\//-}
  GIT_BRANCH=${GIT_BRANCH// /_}

  local RELEASE_NAME="release-$(date +'%Y%m%d-%H%M%S')-${GIT_BRANCH}-${GIT_HASH}"
  local NEST_RELEASE_REMOTE="$NEST_RELEASES_DIR/$RELEASE_NAME"
  local SWITCH_DONE="false"

  # The live commit, read from the newest release folder name before this deploy's own is
  # created. Seeds the commit range on the very first run, when no marker exists yet.
  PREV_FROM_SERVER=$(ssh "$REMOTE_USER_HOST" "ls -1 '$NEST_RELEASES_DIR' 2>/dev/null | sort | tail -1" 2>/dev/null \
    | sed -nE 's/.*-([0-9a-f]{7,40})$/\1/p' || true)

  # Gathered here so a deploy that fails at its very first step still reports something true. Not
  # local: the ERR trap calls zeus_report from outside this function's scope.
  ZEUS_STARTED_AT=$(date -u +%FT%TZ)
  ZEUS_STARTED_EPOCH=$(date +%s)
  ZEUS_RELEASE="$RELEASE_NAME"
  ZEUS_BRANCH="$GIT_BRANCH_RAW"
  ZEUS_COMMIT=$(git rev-parse HEAD 2>/dev/null || true)
  ZEUS_BASE_HASH=$(resolve_base_hash)

  on_error() {
    local lineno=$1
    log "❌ ERROR: API deployment failed at line $lineno"

    if [[ "$SWITCH_DONE" == "true" ]]; then
      log "↩️  Auto rollback: restoring the previous release"
      if remote_rollback; then
        log "✅ Auto rollback succeeded — reloading pm2"
        restart_pm2 || log "❌ pm2 reload after rollback failed, check the server"
        log "ℹ️  Code only — a migration that already applied stays applied"
        # `rolled_back`, not `failed`: the deploy did fail, and ks-b is serving exactly what it
        # served before. That distinction is the whole reason the registry has three statuses.
        zeus_report "rolled_back" "deploy failed at line $lineno — previous release restored" || true
      else
        log "❌ Auto rollback failed, manual intervention required"
        zeus_report "failed" "deploy failed at line $lineno — rollback failed too" || true
      fi
    else
      log "ℹ️  No rollback needed: production was not modified yet"
      zeus_report "failed" "deploy failed at line $lineno — production was not modified" || true
    fi
  }
  trap 'on_error $LINENO' ERR

  log "➡️  Preparing release directory"
  ssh "$REMOTE_USER_HOST" \
    NEST_RELEASES_DIR="$NEST_RELEASES_DIR" \
    NEST_RELEASE_REMOTE="$NEST_RELEASE_REMOTE" \
    API_ROOT="$API_ROOT" \
    DEPLOY_LOG_DIR="$DEPLOY_LOG_DIR" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
mkdir -p "$API_ROOT" "$NEST_RELEASES_DIR" "$DEPLOY_LOG_DIR"
rm -rf "$NEST_RELEASE_REMOTE"
mkdir -p "$NEST_RELEASE_REMOTE"
EOF

  log "➡️  Syncing sources"
  # `.env` is excluded, unlike the sibling scripts, and deliberately: it holds the laptop's
  # development DATABASE_URL, and shipping it puts development credentials on the production box
  # for no benefit. Production configuration is ecosystem.config.js and nothing else.
  rsync -az --delete \
    --exclude=".git" \
    --exclude="node_modules" \
    --exclude="dist" \
    --exclude="generated" \
    --exclude=".env" \
    --exclude=".DS_Store" \
    --exclude="deploy-api.sh" \
    --exclude="ecosystem.config.js" \
    "$SCRIPT_DIR/" \
    "$REMOTE_USER_HOST:$NEST_RELEASE_REMOTE/"

  # Written through a temp file rather than plain scp: the mode has to be right at the moment the
  # content lands, and scp onto an existing path leaves whatever mode that path already had.
  # `umask 077` creates the temp private and `mv` carries that mode across in one step, so there
  # is no window where the database password sits world-readable.
  log "➡️  Syncing ecosystem.config.js"
  ssh "$REMOTE_USER_HOST" \
    "umask 077 && cat > '$API_ROOT/.ecosystem.config.js.tmp' \
      && chmod 600 '$API_ROOT/.ecosystem.config.js.tmp' \
      && mv '$API_ROOT/.ecosystem.config.js.tmp' '$ECOSYSTEM_REMOTE'" \
    < "$SCRIPT_DIR/ecosystem.config.js"

  # Asserted, not assumed. This is the kind of thing that is fixed once and regresses quietly,
  # and a deploy is the only moment anything looks at it.
  log "➡️  Checking the config is not readable beyond its owner"
  ssh "$REMOTE_USER_HOST" ECOSYSTEM_REMOTE="$ECOSYSTEM_REMOTE" 'bash -s' << 'EOF'
set -Eeuo pipefail
mode=$(stat -c '%a' "$ECOSYSTEM_REMOTE")
[ "$mode" = "600" ] || { echo "❌ ERROR: ecosystem.config.js is $mode, expected 600" >&2; exit 1; }
echo "✅ ecosystem.config.js is $mode"
EOF

  log "➡️  Atomic release switch"
  ssh "$REMOTE_USER_HOST" \
    NEST_DIR="$NEST_DIR" \
    NEST_BACKUP_DIR="$NEST_BACKUP_DIR" \
    NEST_RELEASE_REMOTE="$NEST_RELEASE_REMOTE" \
    API_ROOT="$API_ROOT" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
cd "$API_ROOT"
[ -f "$NEST_RELEASE_REMOTE/package.json" ] || { echo "❌ ERROR: release looks empty" >&2; exit 1; }

# Nothing to carry forward: configuration lives in ecosystem.config.js at $API_ROOT, outside the
# directory being swapped, and so survives on its own.
rm -rf "$NEST_BACKUP_DIR"
[ -d "$NEST_DIR" ] && mv "$NEST_DIR" "$NEST_BACKUP_DIR"
mv "$NEST_RELEASE_REMOTE" "$NEST_DIR"
echo "✅ New API release activated"
EOF

  SWITCH_DONE="true"

  log "➡️  Installing and building on the server"
  ssh "$REMOTE_USER_HOST" \
    NEST_DIR="$NEST_DIR" \
    ECOSYSTEM_REMOTE="$ECOSYSTEM_REMOTE" \
    PM2_APP_NAME="$PM2_APP_NAME" \
    REMOTE_PATH="$REMOTE_PATH" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
export PATH="$REMOTE_PATH:$PATH"
command -v pnpm >/dev/null 2>&1 || { echo "❌ ERROR: pnpm not found on the server" >&2; exit 1; }

cd "$NEST_DIR"
rm -rf node_modules dist

# --prod=false explicitly: the build needs the Prisma CLI and the Nest CLI, both devDependencies,
# and NODE_ENV=production would otherwise skip them.
pnpm install --frozen-lockfile --prod=false

# `prebuild` runs `prisma generate`, which only needs DATABASE_URL to exist — it never connects.
# Reading the production one here anyway keeps a single source for it.
DATABASE_URL=$(node -p \
  'const c = require(process.env.ECOSYSTEM_REMOTE); const a = (c.apps || []).find(x => x.name === process.env.PM2_APP_NAME); (a && a.env_production && a.env_production.DATABASE_URL) || ""' \
  2>/dev/null || true)
[ -n "$DATABASE_URL" ] || { echo "❌ ERROR: no env_production.DATABASE_URL for '$PM2_APP_NAME' in $ECOSYSTEM_REMOTE" >&2; exit 1; }
export DATABASE_URL
pnpm build
EOF

  log "➡️  Applying database migrations"
  apply_migrations

  log "➡️  Reloading pm2"
  restart_pm2

  log "➡️  Verifying /health"
  verify_health

  trap - ERR

  write_deploy_log || log "⚠️  Deploy changelog update skipped (non-fatal)"
  zeus_report "success" || log "⚠️  Zeus was not told about this deploy (non-fatal)"

  log "✅ API deployed on port $API_PORT"
  log "ℹ️  Previous version: $NEST_BACKUP_DIR"
  log "ℹ️  Rollback with: ./deploy-api.sh rollback"
}

rollback() {
  log "↩️  Manual rollback"

  # This restores code and nothing else. Prisma has no down-migration, so rolling back across a
  # schema change puts the old code in front of the new schema — extra columns it ignores, which
  # is survivable, or a table under a name the migration changed, which is not. Reverting a
  # migration is a decision about data, and a deploy script is the wrong place to make it.
  log "ℹ️  The database schema is NOT reverted — rolling back across a migration needs a hand"

  ZEUS_STARTED_AT=$(date -u +%FT%TZ)
  ZEUS_STARTED_EPOCH=$(date +%s)
  ZEUS_REPORT_COMMITS="false"

  if remote_rollback; then
    restart_pm2
    zeus_report "rolled_back" "manual rollback — the previous release is live again" || true
    log "✅ Previous API version is live again"
  else
    zeus_report "failed" "manual rollback failed — ks-b needs looking at" || true
    die "rollback failed. Check the server."
  fi
}

case "${1:-deploy}" in
  deploy) deploy ;;
  rollback) rollback ;;
  *) echo "Usage: $0 [deploy|rollback]"; exit 1 ;;
esac
