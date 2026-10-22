#!/usr/bin/env bash
set -euo pipefail

if [[ ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([[:xdigit:]]{40})$ ]]; then
  exec /srv/docker/chatwoot/deploy.sh "${BASH_REMATCH[1]}"
fi

echo 'Only deploy <40-character hex SHA> is allowed' >&2
exit 2
