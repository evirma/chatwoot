#!/usr/bin/env bash
set -euo pipefail

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
export DEPLOY_DIR="$test_dir/deploy"
export CALL_LOG="$test_dir/call"
export REMOTE_SHA=0123456789abcdef0123456789abcdef01234567
export GIT_STATUS=0 DEPLOY_STATUS=0
mkdir -p "$DEPLOY_DIR" "$test_dir/bin"
export PATH="$test_dir/bin:$PATH"
script="$(cd "$(dirname "$0")" && pwd)/auto-deploy.sh"

cat > "$test_dir/bin/git" <<'MOCK'
#!/usr/bin/env bash
[[ $* == 'ls-remote https://github.com/evirma/chatwoot.git refs/heads/evirma/main' ]] || exit 99
printf '%s\trefs/heads/evirma/main\n' "$REMOTE_SHA"
exit "$GIT_STATUS"
MOCK
cat > "$DEPLOY_DIR/deploy.sh" <<'MOCK'
#!/usr/bin/env bash
flock -n "$DEPLOY_DIR/deploy.lock" true || exit 99
printf '%s\n' "$@" > "$CALL_LOG"
echo 'mock deploy output'
exit "$DEPLOY_STATUS"
MOCK
chmod 700 "$test_dir/bin/git" "$DEPLOY_DIR/deploy.sh"

printf '%s\n' "$REMOTE_SHA" > "$DEPLOY_DIR/deployed.sha"
bash "$script" > "$test_dir/output" 2>&1
[[ ! -e $CALL_LOG && ! -s $test_dir/output && ! -s $DEPLOY_DIR/auto-deploy.log ]]
rm "$DEPLOY_DIR/deployed.sha"
echo 'PASS: deployed SHA skipped quietly'

printf '%s\n' "$REMOTE_SHA" > "$DEPLOY_DIR/failed.sha"
bash "$script" > "$test_dir/output" 2>&1
[[ ! -e $CALL_LOG && ! -s $test_dir/output && ! -s $DEPLOY_DIR/auto-deploy.log ]]
echo 'PASS: failed SHA skipped quietly'

export REMOTE_SHA=abcdef0123456789abcdef0123456789abcdef01
export DEPLOY_STATUS=1
status=0
bash "$script" || status=$?
[[ $status == 1 && $(cat "$CALL_LOG") == "$REMOTE_SHA" ]]
[[ $(cat "$DEPLOY_DIR/failed.sha") == "$REMOTE_SHA" ]]
[[ $(cat "$DEPLOY_DIR/auto-deploy.log") == *"$REMOTE_SHA DEPLOY_FAIL exit=1"* ]]
rm "$CALL_LOG"
echo 'PASS: new SHA deployed and failure recorded'

export REMOTE_SHA=1111111111111111111111111111111111111111
export DEPLOY_STATUS=0
bash "$script"
[[ $(cat "$CALL_LOG") == "$REMOTE_SHA" ]]
[[ $(cat "$DEPLOY_DIR/auto-deploy.log") == *"$REMOTE_SHA DEPLOY_OK"* ]]
[[ $(cat "$DEPLOY_DIR/auto-deploy.log") == *'mock deploy output'* ]]
rm "$CALL_LOG"
echo 'PASS: successful deployment logged and probe lock released'

cp "$DEPLOY_DIR/auto-deploy.log" "$test_dir/log-before"
exec 9> "$DEPLOY_DIR/deploy.lock"
flock -n 9
bash "$script" 9>&- > "$test_dir/output" 2>&1
[[ ! -e $CALL_LOG && ! -s $test_dir/output ]]
cmp "$test_dir/log-before" "$DEPLOY_DIR/auto-deploy.log"
exec 9>&-
echo 'PASS: busy lock skipped quietly'

export REMOTE_SHA=garbage
status=0
bash "$script" || status=$?
[[ $status != 0 && ! -e $CALL_LOG ]]
[[ $(cat "$DEPLOY_DIR/auto-deploy.log") == *'REMOTE_FAIL expected 40 hex characters'* ]]
echo 'PASS: invalid SHA rejected'

export REMOTE_SHA=2222222222222222222222222222222222222222
export GIT_STATUS=1
status=0
bash "$script" || status=$?
[[ $status != 0 && ! -e $CALL_LOG ]]
[[ $(cat "$DEPLOY_DIR/auto-deploy.log") == *'REMOTE_FAIL git ls-remote failed'* ]]
echo 'PASS: remote lookup failure logged'
