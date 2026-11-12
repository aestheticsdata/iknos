#!/usr/bin/env bash
# Iknos's database backup, every 3 hours. Runs ON ks-b from the iknos-backup systemd timer
# (installed by deploy/install-backup.sh), never from the laptop. It is a timer rather than a
# `@Cron` in the API because ks-b stops the pm2 fleet overnight, and a dump that only runs while
# the API is up would miss every night.
#
# What is dumped: the structure of every table, and the data of everything except the telemetry.
# The tables in `MANAGED_TABLES` (nest-api/src/maintenance/maintenance.service.ts) are rolling
# streams that `DROP PARTITION` expires within days. Dumping them would mean ~2.5 GB eight times a
# day to protect rows that are deleted on purpose anyway. What cannot be rebuilt is what people
# configured: users, services, alert rules, issues, ingest offsets.
#
#   1. mysqldump --no-data of the schema, then the data minus the telemetry, gzipped into one file
#   2. kept on ks-b: the newest $KEEP dated dumps in ~/iknosbackupdb (a week at 3-hourly)
#   3. pushed to memosyne with Iknos's own key, which memosyne restricts to one forced command that
#      writes ~/iknosbackupdb/iknosdump.sql.gz and answers the size it wrote
#   4. reported to Zeus under the cron key `db-backup`; a dump that did not reach memosyne is never
#      reported `ok`
set -Euo pipefail

APP="iknos"
SCHEDULE="45 */3 * * *"
LOCAL_DIR="$HOME/iknosbackupdb"
KEEP=56
MEMOSYNE="debian@146.59.197.167"
KEY="$HOME/.ssh/iknos_backup_id_ed25519"
ECO="/var/www/iknos/ecosystem.config.js"
# The ingest token is Zeus's, read where deploy-api.sh reads it: it never lands in this repo.
ZEUS_ECO="/var/www/zeus/ecosystem.config.js"
CRON_INGEST_URL="http://127.0.0.1:6600/api/cron-runs"
# Keep in step with MANAGED_TABLES.
TELEMETRY=(log_entry metric_sample health_check host_sample process_sample issue_event alert_state_change metric_rollup)

started_at=$(date -u +%FT%TZ)
started_ms=$(date +%s%3N)

json_escape() { local s="$1"; s=${s//\\/\\\\}; s=${s//\"/\\\"}; printf '%s' "$s"; }

report() {
  local status="$1" summary="$2" detail="$3" token payload code
  echo "$status: $summary"
  token=$(sed -n "s/.*ZEUS_INGEST_TOKEN: *['\"]\([^'\"]*\)['\"].*/\1/p" "$ZEUS_ECO" 2>/dev/null | tail -1)
  if [ -z "$token" ]; then echo "zeus: not reported — no ZEUS_INGEST_TOKEN in $ZEUS_ECO"; return 0; fi
  payload=$(printf '{"app":"%s","cron":"db-backup","status":"%s","startedAt":"%s","schedule":"%s","durationMs":%s,"summary":"%s","detail":%s}' \
    "$APP" "$status" "$started_at" "$SCHEDULE" "$(( $(date +%s%3N) - started_ms ))" "$(json_escape "${summary:0:200}")" "$detail")
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -X POST "$CRON_INGEST_URL" \
    -H 'content-type: application/json' -H "authorization: Bearer $token" --data-binary "$payload" || true)
  [ "$code" = "202" ] || echo "zeus: report not recorded (HTTP ${code:-none})"
}

# The API's own credentials, off its ecosystem file. The password goes through MYSQL_PWD, never argv.
url=$(node -e 'const a=require(process.argv[1]).apps.find((a)=>a.name==="iknos-api");console.log((a.env_production||a.env).DATABASE_URL)' "$ECO") || {
  report "failed" "cannot read DATABASE_URL from $ECO" '{"offsite":false}'; exit 1; }
db_user=$(node -e 'console.log(decodeURIComponent(new URL(process.argv[1]).username))' "$url")
db_name=$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$url")
MYSQL_PWD=$(node -e 'console.log(decodeURIComponent(new URL(process.argv[1]).password))' "$url")
export MYSQL_PWD

mkdir -p "$LOCAL_DIR" && chmod 700 "$LOCAL_DIR"
file="$LOCAL_DIR/iknos-$(date -u +%Y%m%d-%H%M%S).sql.gz"
ignored=()
for table in "${TELEMETRY[@]}"; do ignored+=("--ignore-table=$db_name.$table"); done
common=(--host=127.0.0.1 --user="$db_user" --single-transaction --no-tablespaces --set-gtid-purged=OFF)

if ! { mysqldump "${common[@]}" --no-data "$db_name" &&
       mysqldump "${common[@]}" --no-create-info "${ignored[@]}" "$db_name"; } 2> "$file.err" | gzip > "$file"; then
  report "failed" "mysqldump of $db_name failed: $(head -c 150 "$file.err" | tr '\n' ' ')" '{"offsite":false}'
  rm -f "$file" "$file.err"
  exit 1
fi
rm -f "$file.err"
chmod 600 "$file"
bytes=$(stat -c %s "$file")

# Retention on ks-b only; nothing here ever deletes on memosyne.
find "$LOCAL_DIR" -maxdepth 1 -name 'iknos-*.sql.gz' -printf '%f\n' | sort -r | tail -n +"$((KEEP + 1))" |
  while IFS= read -r old; do rm -f "$LOCAL_DIR/$old"; done

remote_bytes=$(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$MEMOSYNE" < "$file" 2>/dev/null || true)
if [ "$remote_bytes" != "$bytes" ]; then
  report "failed" "dumped $db_name ($bytes bytes) → $file, but the offsite copy failed (memosyne answered '${remote_bytes:-nothing}')" \
    "{\"dest\":\"$file\",\"bytes\":$bytes,\"offsite\":false}"
  exit 1
fi

report "ok" "dumped $db_name without telemetry ($bytes bytes) → $file, copied to memosyne" \
  "{\"dest\":\"$file\",\"bytes\":$bytes,\"offsite\":true}"
