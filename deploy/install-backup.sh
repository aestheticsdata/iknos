#!/usr/bin/env bash
# Installs Iknos's 3-hourly database backup, from the laptop. Idempotent: run it again after
# changing deploy/backup-db.sh. Tessera's installer (TES-23) is the pattern.
#
#   1. copies backup-db.sh to ks-b
#   2. gives ks-b its own key for Iknos's backups (never a copy of another app's), and authorises
#      it on memosyne behind a forced command: that key can write iknosbackupdb/iknosdump.sql.gz
#      and nothing else — no shell, no forwarding, no other path
#   3. installs a systemd timer on ks-b (every 3 hours at :45 UTC, clear of the other apps' dumps
#      at :00, :15 and :30)
#   4. runs one backup now, so the first report does not wait three hours
set -Eeuo pipefail

REMOTE_USER_HOST="${REMOTE_USER_HOST:-debian@ks-b}"
MEMOSYNE_SSH="${MEMOSYNE_SSH:-memosyne}"
REPO_DIR="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
SCRIPT_REMOTE="/var/www/iknos/backup-db.sh"
LOG_REMOTE="/var/www/iknos/deploy-logs/backup-db.log"
KEY_REMOTE=".ssh/iknos_backup_id_ed25519"
# Written to a temporary name and renamed, so a cut connection never leaves a half dump in place.
FORCED='mkdir -p iknosbackupdb && cat > iknosbackupdb/.iknosdump.part && mv iknosbackupdb/.iknosdump.part iknosbackupdb/iknosdump.sql.gz && stat -c %s iknosbackupdb/iknosdump.sql.gz'

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"; }

log "➡️  backup-db.sh to ks-b"
scp -q "$REPO_DIR/deploy/backup-db.sh" "$REMOTE_USER_HOST:$SCRIPT_REMOTE"
ssh "$REMOTE_USER_HOST" "chmod 755 '$SCRIPT_REMOTE'"

log "➡️  Iknos's backup key"
ssh "$REMOTE_USER_HOST" KEY="$KEY_REMOTE" 'bash -s' << 'EOF'
set -Eeuo pipefail
[ -f "$HOME/$KEY" ] || ssh-keygen -q -t ed25519 -f "$HOME/$KEY" -N '' -C iknos-backup
EOF
pub=$(ssh "$REMOTE_USER_HOST" "cat '$KEY_REMOTE.pub'")
# The key and the command hold spaces: quoted for the remote shell, which re-splits ssh's arguments.
ssh "$MEMOSYNE_SSH" "PUB=$(printf %q "$pub") FORCED=$(printf %q "$FORCED") bash -s" << 'EOF'
set -Eeuo pipefail
key_body=$(printf '%s' "$PUB" | awk '{print $2}')
touch ~/.ssh/authorized_keys
if grep -qF "$key_body" ~/.ssh/authorized_keys; then
  grep -vF "$key_body" ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.new
  mv ~/.ssh/authorized_keys.new ~/.ssh/authorized_keys
fi
printf 'restrict,command="%s" %s\n' "$FORCED" "$PUB" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
EOF

log "➡️  memosyne's host key on ks-b"
ssh "$REMOTE_USER_HOST" 'ssh-keygen -F 146.59.197.167 >/dev/null || ssh-keyscan -t ed25519 146.59.197.167 2>/dev/null >> ~/.ssh/known_hosts'

# ks-b has no cron daemon: a systemd timer, run as debian. Persistent=true runs a slot missed while
# the machine was down at the next boot.
log "➡️  systemd timer on ks-b"
ssh "$REMOTE_USER_HOST" "SCRIPT=$(printf %q "$SCRIPT_REMOTE") LOG=$(printf %q "$LOG_REMOTE") bash -s" << 'EOF'
set -Eeuo pipefail
mkdir -p "$(dirname "$LOG")"
sudo -n tee /etc/systemd/system/iknos-backup.service >/dev/null << UNIT
[Unit]
Description=Iknos database backup, telemetry excluded
After=mysql.service network-online.target

[Service]
Type=oneshot
User=debian
ExecStart=/bin/bash -c '$SCRIPT >> $LOG 2>&1'
UNIT
sudo -n tee /etc/systemd/system/iknos-backup.timer >/dev/null << UNIT
[Unit]
Description=Iknos database backup every 3 hours at :45 UTC

[Timer]
OnCalendar=*-*-* 00/3:45:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now iknos-backup.timer
systemctl list-timers iknos-backup.timer --no-pager --no-legend
EOF

log "➡️  One backup now"
ssh "$REMOTE_USER_HOST" "$SCRIPT_REMOTE"
log "✅ 3-hourly backup installed"
