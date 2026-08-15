#!/usr/bin/env bash
#
# Ship the static mock to ks-b. Run from the laptop:
#
#   ./deploy/deploy-mock.sh
#
# There is no release directory, no atomic switch and no rollback here, on
# purpose: this is one HTML file with no data behind it, and the whole point is
# that editing it and seeing the result takes seconds. The real deploy scripts
# (IKN-4) arrive with the apps they deploy.
#
# Retire this script when `location /` in deploy/nginx/iknos.conf stops serving
# static files.

set -euo pipefail

HOST="${IKNOS_DEPLOY_HOST:-ks-b}"
REMOTE_DIR="/var/www/iknos/public_html"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../mock" && pwd)"

echo "→ ${LOCAL_DIR}  ⇒  ${HOST}:${REMOTE_DIR}"

ssh "$HOST" "mkdir -p ${REMOTE_DIR}"

# --delete so a file removed locally disappears on the server too; without it the
# mock accumulates orphans nobody remembers writing.
#
# No --chmod: macOS ships openrsync, which does not have the flag. Permissions
# are set on the far side instead, where the shell is GNU and predictable.
rsync -az --delete "${LOCAL_DIR}/" "${HOST}:${REMOTE_DIR}/"

ssh "$HOST" "find ${REMOTE_DIR} -type d -exec chmod 755 {} + && find ${REMOTE_DIR} -type f -exec chmod 644 {} +"

echo "→ verifying"
code="$(curl -s -o /dev/null -w '%{http_code}' https://iknos.1991computer.com/)"
if [ "$code" != "200" ]; then
  echo "✗ https://iknos.1991computer.com/ answered ${code}, expected 200" >&2
  exit 1
fi

echo "✓ https://iknos.1991computer.com/  ${code}"
