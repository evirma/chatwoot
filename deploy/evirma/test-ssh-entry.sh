#!/usr/bin/env bash
set -euo pipefail

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
export CALL_LOG="$test_dir/call"
cat > "$test_dir/deploy.sh" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CALL_LOG"
exit 17
MOCK
chmod 700 "$test_dir/deploy.sh"
sed "s|/srv/docker/chatwoot/deploy.sh|$test_dir/deploy.sh|" \
  "$(dirname "$0")/ssh-entry.sh" > "$test_dir/entry.sh"

sha=0123456789abcdef0123456789abcdef01234567
status=0
SSH_ORIGINAL_COMMAND="deploy $sha" bash "$test_dir/entry.sh" || status=$?
[[ $status == 17 && $(cat "$CALL_LOG") == "$sha" ]]
rm "$CALL_LOG"

for command in 'deploy x' 'rm -rf /' '' "deploy $sha; id" \
  "deploy $sha extra" $'deploy\t'"$sha" $'deploy '"$sha"$'\n'; do
  status=0
  SSH_ORIGINAL_COMMAND="$command" bash "$test_dir/entry.sh" 2>/dev/null || status=$?
  [[ $status == 2 && ! -e $CALL_LOG ]]
done
echo 'SSH entry: valid command and exit status passed; 7 invalid commands rejected'
