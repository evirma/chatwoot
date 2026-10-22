#!/usr/bin/env bash
set -euo pipefail
umask 077

DEPLOY_DIR=${DEPLOY_DIR:-/srv/docker/chatwoot}
REPO_URL=https://github.com/evirma/chatwoot.git
REPO_REF=refs/heads/evirma/main
DEPLOY_SCRIPT="$DEPLOY_DIR/deploy.sh"
DEPLOYED_SHA="$DEPLOY_DIR/deployed.sha"
FAILED_SHA="$DEPLOY_DIR/failed.sha"
DEPLOY_LOCK="$DEPLOY_DIR/deploy.lock"
LOG_FILE="$DEPLOY_DIR/auto-deploy.log"

exec >> "$LOG_FILE" 2>&1
if ! remote=$(git ls-remote "$REPO_URL" "$REPO_REF" | cut -f1); then
  printf '%s unknown REMOTE_FAIL git ls-remote failed\n' "$(date -Iseconds)"
  exit 1
fi
if [[ ! $remote =~ ^[[:xdigit:]]{40}$ ]]; then
  printf '%s unknown REMOTE_FAIL expected 40 hex characters\n' "$(date -Iseconds)"
  exit 1
fi

if [[ -f $DEPLOYED_SHA && $remote == "$(<"$DEPLOYED_SHA")" ]]; then
  exit 0
fi
if [[ -f $FAILED_SHA && $remote == "$(<"$FAILED_SHA")" ]]; then
  exit 0
fi
if ! flock -n "$DEPLOY_LOCK" true; then
  exit 0
fi

status=0
"$DEPLOY_SCRIPT" "$remote" || status=$?
if (( status != 0 )); then
  printf '%s\n' "$remote" > "$FAILED_SHA"
  printf '%s %s DEPLOY_FAIL exit=%s\n' "$(date -Iseconds)" "$remote" "$status"
else
  printf '%s %s DEPLOY_OK\n' "$(date -Iseconds)" "$remote"
fi
exit "$status"
