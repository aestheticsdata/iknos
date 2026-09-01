#!/usr/bin/env bash
set -Eeuo pipefail

# Deploys the Iknos front. Same shape as deploy-api.sh and its siblings across the fleet: rsync
# into a fresh release directory, atomic switch keeping the previous version as a backup, install
# and build on the server, pm2 reload, verify the sign-in page answers, with automatic rollback if
# anything fails after the switch.
#
# Usage: ./deploy-front.sh [deploy|rollback]

######################################
# Configuration
######################################
REMOTE_USER_HOST="debian@ks-b"

WEB_ROOT="/var/www/iknos"
FRONT_DIR="$WEB_ROOT/front"
FRONT_BACKUP_DIR="$WEB_ROOT/front.bak"
FRONT_RELEASES_DIR="$WEB_ROOT/front-releases"

# Deliberately NOT `public_html`, which is where the sibling front scripts put their app: that
# directory holds the static mock, and nginx still serves `/` from it until the app chassis lands
# with the rest of IKN-5. `front/` beside `nest-api/` also matches this repo's own layout.
MOCK_DIR="$WEB_ROOT/public_html"

# Ships inside the release, unlike the API's: the front holds no secret — it talks to the API over
# loopback and has nothing to authenticate with — so the file is committed and travels with the code.
PM2_ECOSYSTEM_FILE="ecosystem.config.cjs"

# The pm2 process name and Iknos's front row in Zeus's registry. Renaming it breaks both.
PM2_APP_NAME="iknos-front"

WEB_PORT="3006"

# The branch a deploy is allowed to ship. The tree must be clean and level with it.
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

# PATH additions for a non-interactive ssh session, which does not source the profile. pnpm lives
# under the user, node and pm2 in /usr/local/bin. Checked on ks-b.
REMOTE_PATH="/home/debian/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin:/usr/sbin"

######################################
# Reporting to Zeus
######################################
ZEUS_APP_NAME="${ZEUS_APP_NAME:-iknos}"
ZEUS_ROLE="front"

# Zeus's own ecosystem file on ks-b, which carries the ingest URL and the shared token. Read there
# rather than carried on the laptop: the secret never travels, never lands in this repo, and never
# appears on an ssh command line where `ps` would show it. The endpoint is loopback-only, so the
# POST has to happen on ks-b whatever else is true.
ZEUS_ECOSYSTEM_FILE="${ZEUS_ECOSYSTEM_FILE:-/var/www/zeus/ecosystem.config.js}"
ZEUS_ENV_FILE="${ZEUS_ENV_FILE:-/var/www/zeus/nest-api/.env}"

DEPLOY_LOG_DIR="$WEB_ROOT/deploy-logs"
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
# Runs before any ssh or rsync: the whole point is to fail here, with nothing on the server touched.
require_clean_tree() {
  cd "$SCRIPT_DIR"

  # Setup problems before readiness problems, same order as deploy-api.sh checks its own untracked
  # config. `.env.production` is not committed, and its absence is silent in a way that matters:
  # the `NEXT_PUBLIC_` values are inlined at build time, so a missing file does not fail the build
  # — it ships a bundle with browser error reporting switched off and nothing anywhere saying so.
  [ -f "$SCRIPT_DIR/.env.production" ] \
    || die "missing front/.env.production — copy .env.example and fill it in. It is not committed."

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

# Everything red before the first byte is uploaded. A check that ran after the atomic switch would
# be a rollback trigger rather than a gate.
#
# No test step, unlike the API's: the front has no suite yet. When it gets one this list is where
# it goes, and the omission is deliberate rather than forgotten.
run_preflight_checks() {
  local names=("lint" "typecheck" "build")
  local commands=("pnpm lint" "pnpm typecheck" "pnpm build")
  local index output

  for index in "${!names[@]}"; do
    log "➡️  Pre-deploy: ${names[$index]}"
    output=$(mktemp)

    # Not left to errexit: the ERR trap installed by deploy() would report a failed deploy upstream
    # before this has said which check failed and why.
    if ! ( cd "$SCRIPT_DIR" && eval "${commands[$index]}" ) > "$output" 2>&1; then
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
# successful deploy, so a second resolution later would return this deploy's own commit and both the
# changelog and the report would come out claiming nothing shipped.
resolve_base_hash() {
  local base
  base=$(ssh "$REMOTE_USER_HOST" "cat '$DEPLOY_MARKER' 2>/dev/null || true" 2>/dev/null || true)
  [ -z "$base" ] && base="${IKNOS_SINCE:-}"
  [ -z "$base" ] && base="${PREV_FROM_SERVER:-}"

  # A hash this checkout does not have is no baseline at all — a shallow clone, or a marker left by
  # a deploy from a branch since rewritten.
  if [ -n "$base" ] && ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    base=""
  fi

  printf '%s' "$base"
}

# The commits this deploy ships, as a JSON array, newest first.
#
# Messages are escaped in awk rather than interpolated into a shell string. `%s` is the subject line
# only, so it cannot contain a newline, and splitting on the first two spaces is exact because
# neither a sha nor an ISO-8601 date contains one.
zeus_commits_json() {
  local -a range

  # A manual rollback restores a release rather than shipping one. Falling through to the last-ten
  # baseline would claim it delivered ten commits it had nothing to do with.
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

# One setting, looked for in the pm2 ecosystem file first and the .env second. That order is not a
# preference, it is the order Zeus's API resolves them: pm2 injects env_production before Nest
# starts, and dotenv does not overwrite a variable that is already there. Reading the .env alone
# would present a token the API is not validating against the day the two disagree — a 401 on every
# report and no other symptom.
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

# 202 is the contract. Anything else is worth one line and nothing more — a deploy that shipped and
# could not say so still shipped.
[ "$code" = "202" ] || echo "zeus: report not recorded (HTTP ${code:-none})"
EOF
}

remote_rollback() {
  ssh "$REMOTE_USER_HOST" \
    FRONT_DIR="$FRONT_DIR" \
    FRONT_BACKUP_DIR="$FRONT_BACKUP_DIR" \
    WEB_ROOT="$WEB_ROOT" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
cd "$WEB_ROOT"
[ -d "$FRONT_BACKUP_DIR" ] || { echo "❌ ERROR: no backup at $FRONT_BACKUP_DIR" >&2; exit 1; }
rm -rf "$FRONT_DIR"
mv "$FRONT_BACKUP_DIR" "$FRONT_DIR"
echo "✅ Front rollback done (restored from backup)"
EOF
}

restart_pm2() {
  ssh "$REMOTE_USER_HOST" \
    FRONT_DIR="$FRONT_DIR" \
    PM2_ECOSYSTEM_FILE="$PM2_ECOSYSTEM_FILE" \
    REMOTE_PATH="$REMOTE_PATH" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
export PATH="$REMOTE_PATH:$PATH"
cd "$FRONT_DIR"
command -v pm2 >/dev/null 2>&1 || { echo "❌ ERROR: pm2 not found on the server" >&2; exit 1; }

# No `--env production`: the front's ecosystem declares a plain `env` block, because it has no
# second environment to switch between and nothing secret to keep out of one.
pm2 startOrReload "$PM2_ECOSYSTEM_FILE" --update-env
pm2 save
EOF
}

# Fails the deploy if what just shipped cannot answer. A deploy that reports success while the front
# is down is the failure mode this exists to prevent.
#
# `/login/` and not `/`: nginx owns `/` and still points it at the mock, so the front's own root is
# a redirect to here. The trailing slash is `trailingSlash: true` — without it this asks for a 308
# and reads the redirect body as the page.
verify_ready() {
  ssh "$REMOTE_USER_HOST" \
    WEB_PORT="$WEB_PORT" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
body=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  body=$(curl -fsS --max-time 5 "http://127.0.0.1:$WEB_PORT/login/" 2>/dev/null || true)
  case "$body" in
    # The heading of the sign-in card. A 200 alone would also be satisfied by Next's error page.
    *'sign in'*)
      echo "✅ front: /login/ renders"
      exit 0
      ;;
  esac
  sleep 2
done

if [ -n "$body" ]; then
  echo "❌ ERROR: the front answered something unexpected after 30s" >&2
else
  echo "❌ ERROR: the front did not answer /login/ after 30s" >&2
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

  # One git-log call captured into a variable: no `| grep -q` on a pipe git may SIGPIPE, which would
  # trip pipefail.
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

# The pnpm version is deliberately not written down here. Each project pins it
# in package.json ("packageManager") and both machines switch to that version on
# their own. What this guards is the *baseline* pnpm — the binary that performs
# the switch. A server baseline older than this machine's may not honour the pin
# at all, in which case the build would quietly run on the wrong pnpm.
#
# npm_config_manage_package_manager_versions=false bypasses the pin: without it
# both sides would report the pinned version and the comparison would prove
# nothing. It has to be the environment variable — the equivalent
# `--config.manage-package-manager-versions=false` flag is silently ignored
# here, because the version switch happens before flags are parsed.
check_pnpm_baseline() {
  local local_v remote_v oldest

  local_v=$(npm_config_manage_package_manager_versions=false pnpm -v 2>/dev/null) || {
    echo "❌ ERROR: pnpm not found on this machine" >&2
    exit 1
  }

  remote_v=$(ssh "$REMOTE_USER_HOST" \
    'export PATH="$HOME/.local/share/pnpm:$PATH"; npm_config_manage_package_manager_versions=false pnpm -v' \
    2>/dev/null) || {
    echo "❌ ERROR: pnpm not found on the server" >&2
    exit 1
  }

  oldest=$(printf '%s\n%s\n' "$local_v" "$remote_v" | sort -V | head -1)
  if [ "$remote_v" != "$local_v" ] && [ "$oldest" = "$remote_v" ]; then
    echo "❌ ERROR: the server's pnpm ($remote_v) is older than this machine's ($local_v)." >&2
    echo "   Update pnpm on the server before deploying." >&2
    exit 1
  fi

  log "➡️  pnpm baseline — local $local_v / server $remote_v"
}

deploy() {
  check_pnpm_baseline
  cd "$SCRIPT_DIR"

  require_clean_tree
  run_preflight_checks

  GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "no-git")
  GIT_BRANCH_RAW=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-branch")
  local GIT_BRANCH=${GIT_BRANCH_RAW//\//-}
  GIT_BRANCH=${GIT_BRANCH// /_}

  local RELEASE_NAME="release-$(date +'%Y%m%d-%H%M%S')-${GIT_BRANCH}-${GIT_HASH}"
  local FRONT_RELEASE_REMOTE="$FRONT_RELEASES_DIR/$RELEASE_NAME"
  local SWITCH_DONE="false"

  # The live commit, read from the newest release folder name before this deploy's own is created.
  # Seeds the commit range on the very first run, when no marker exists yet.
  PREV_FROM_SERVER=$(ssh "$REMOTE_USER_HOST" "ls -1 '$FRONT_RELEASES_DIR' 2>/dev/null | sort | tail -1" 2>/dev/null \
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
    log "❌ ERROR: front deployment failed at line $lineno"

    if [[ "$SWITCH_DONE" == "true" ]]; then
      log "↩️  Auto rollback: restoring the previous release"
      if remote_rollback; then
        log "✅ Auto rollback succeeded — reloading pm2"
        restart_pm2 || log "❌ pm2 reload after rollback failed, check the server"
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
    FRONT_RELEASES_DIR="$FRONT_RELEASES_DIR" \
    FRONT_RELEASE_REMOTE="$FRONT_RELEASE_REMOTE" \
    WEB_ROOT="$WEB_ROOT" \
    DEPLOY_LOG_DIR="$DEPLOY_LOG_DIR" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
mkdir -p "$WEB_ROOT" "$FRONT_RELEASES_DIR" "$DEPLOY_LOG_DIR"
rm -rf "$FRONT_RELEASE_REMOTE"
mkdir -p "$FRONT_RELEASE_REMOTE"
EOF

  log "➡️  Syncing sources"
  # `.next` is excluded and rebuilt on the server: a build carries absolute paths and native
  # binaries from wherever it ran, and this laptop is not that machine.
  rsync -az --delete \
    --exclude=".git" \
    --exclude="node_modules" \
    --exclude=".next" \
    --exclude=".env" \
    --exclude=".DS_Store" \
    --exclude="deploy-front.sh" \
    "$SCRIPT_DIR/" \
    "$REMOTE_USER_HOST:$FRONT_RELEASE_REMOTE/"

  log "➡️  Atomic release switch"
  ssh "$REMOTE_USER_HOST" \
    FRONT_DIR="$FRONT_DIR" \
    FRONT_BACKUP_DIR="$FRONT_BACKUP_DIR" \
    FRONT_RELEASE_REMOTE="$FRONT_RELEASE_REMOTE" \
    MOCK_DIR="$MOCK_DIR" \
    WEB_ROOT="$WEB_ROOT" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
cd "$WEB_ROOT"
[ -f "$FRONT_RELEASE_REMOTE/package.json" ] || { echo "❌ ERROR: release looks empty" >&2; exit 1; }

# The mock is not this script's to touch, and the day it is removed that is a commit, not a side
# effect of a deploy. Asserted rather than assumed: `/` would 404 for every visitor.
[ -f "$MOCK_DIR/index.html" ] || echo "⚠️  no mock at $MOCK_DIR/index.html — nginx still serves / from there"

rm -rf "$FRONT_BACKUP_DIR"
[ -d "$FRONT_DIR" ] && mv "$FRONT_DIR" "$FRONT_BACKUP_DIR"
mv "$FRONT_RELEASE_REMOTE" "$FRONT_DIR"
echo "✅ New front release activated"
EOF

  SWITCH_DONE="true"

  log "➡️  Installing and building on the server"
  ssh "$REMOTE_USER_HOST" \
    FRONT_DIR="$FRONT_DIR" \
    REMOTE_PATH="$REMOTE_PATH" \
    'bash -s' << 'EOF'
set -Eeuo pipefail
export PATH="$REMOTE_PATH:$PATH"
command -v pnpm >/dev/null 2>&1 || { echo "❌ ERROR: pnpm not found on the server" >&2; exit 1; }

cd "$FRONT_DIR"
rm -rf node_modules .next

# --prod=false explicitly: the build needs Tailwind, TypeScript and the React compiler plugin, all
# devDependencies, and NODE_ENV=production would otherwise skip them.
pnpm install --frozen-lockfile --prod=false

# `next/font` downloads the two families at build time and self-hosts them. That is one outbound
# request from ks-b during the build and none at all afterwards — the price of the eventual CSP
# naming no font CDN.
pnpm build
EOF

  log "➡️  Reloading pm2"
  restart_pm2

  log "➡️  Verifying the sign-in page"
  verify_ready

  trap - ERR

  write_deploy_log || log "⚠️  Deploy changelog update skipped (non-fatal)"
  zeus_report "success" || log "⚠️  Zeus was not told about this deploy (non-fatal)"

  log "✅ Front deployed on port $WEB_PORT"
  log "ℹ️  Previous version: $FRONT_BACKUP_DIR"
  log "ℹ️  Rollback with: ./deploy-front.sh rollback"
}

rollback() {
  log "↩️  Manual rollback"

  ZEUS_STARTED_AT=$(date -u +%FT%TZ)
  ZEUS_STARTED_EPOCH=$(date +%s)
  ZEUS_REPORT_COMMITS="false"

  if remote_rollback; then
    restart_pm2
    zeus_report "rolled_back" "manual rollback — the previous release is live again" || true
    log "✅ Previous front version is live again"
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
