#!/usr/bin/env bash
set -euo pipefail
umask 077

DEPLOY_DIR=/srv/docker/chatwoot
REPO_DIR=/srv/docker/chatwoot-fork
REPO_URL=https://github.com/evirma/chatwoot.git
REPO_BRANCH=evirma/main
COMPOSE_FILE=compose.evirma.yml
PROJECT=chatwoot
DOMAIN=https://support.evirma.ru
IMAGE_PREFIX=evirma/chatwoot:v4.18.0-evirma
HEALTH_TIMEOUT=300

if [[ $# -ne 1 || ! $1 =~ ^[[:xdigit:]]{40}$ ]]; then
  echo 'DEPLOY_FAIL expected one SHA of exactly 40 hex characters' >&2
  exit 2
fi

sha=$(printf '%s' "$1" | tr 'A-F' 'a-f')
image="$IMAGE_PREFIX-${sha:0:7}"
cd "$DEPLOY_DIR"
run_date=$(date +%Y%m%d-%H%M%S-%N)
exec > >(tee -a "$DEPLOY_DIR/deploy-$run_date-${sha:0:7}.log") 2>&1

work_dir=
backup=
previous_image=
rollback_needed=false
failure='deployment failed'
compose=(docker compose -p "$PROJECT" -f "$COMPOSE_FILE")

finish() {
  status=$?
  trap - EXIT
  if (( status != 0 )) && $rollback_needed; then
    echo "Restoring $previous_image from $backup"
    if cp -p "$backup" "$COMPOSE_FILE" &&
      CHATWOOT_IMAGE="$previous_image" "${compose[@]}" up -d rails sidekiq; then
      echo 'Previous compose and image restored; database migrations are unchanged'
    else
      failure="$failure; ROLLBACK FAILED, restore $backup manually"
    fi
  fi
  if [[ -n $work_dir ]]; then
    rm -rf "$work_dir"
  fi
  if (( status == 0 )); then
    echo "DEPLOY_OK $image"
  else
    echo "DEPLOY_FAIL $failure"
  fi
  exit "$status"
}
trap finish EXIT
trap 'failure="deployment interrupted"; exit 1' HUP INT TERM

failure='another deployment holds deploy.lock; retry after it finishes'
exec 9> "$DEPLOY_DIR/deploy.lock"
flock -n 9

failure='could not create build directory'
work_dir=$(mktemp -d "$DEPLOY_DIR/deploy-${sha:0:7}.XXXXXX")
if ! docker image inspect "$image" >/dev/null 2>&1; then
  failure='could not fetch fork source'
  if [[ ! -d $REPO_DIR ]]; then
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
  fi
  git -C "$REPO_DIR" fetch origin "$REPO_BRANCH"
  failure='could not prepare build context'
  git -C "$REPO_DIR" archive "$sha" | tar -x -C "$work_dir"
  rm -rf "$work_dir/enterprise" "$work_dir/spec/enterprise"
  sed -i "s/git rev-parse HEAD/echo $sha/" "$work_dir/docker/Dockerfile"
  printf '\nENV CW_EDITION="ce"\n' >> "$work_dir/docker/Dockerfile"
  failure='image build failed'
  docker build --platform linux/amd64 -f "$work_dir/docker/Dockerfile" -t "$image" "$work_dir"
  echo "BUILD_OK $image"
else
  echo "Using existing image $image"
fi

failure='could not inspect the running Rails image'
previous_image=$(docker inspect --format '{{.Config.Image}}' "$PROJECT-rails-1")

failure='database preparation failed; services have not been restarted'
CHATWOOT_IMAGE="$image" "${compose[@]}" run --rm rails bundle exec rails db:chatwoot_prepare

failure='compose does not contain a CHATWOOT_IMAGE default'
# The server's grep is ripgrep, so the check uses the shell's own regex matching.
image_default='\$\{CHATWOOT_IMAGE:-[^}]+\}'
[[ $(<"$COMPOSE_FILE") =~ $image_default ]]
backup="$COMPOSE_FILE.$run_date.${previous_image##*:}.bak"
failure='could not back up compose'
cp -p "$COMPOSE_FILE" "$backup"
rollback_needed=true
failure='could not update compose image'
sed -i -E 's|\$\{CHATWOOT_IMAGE:-[^}]+\}|${CHATWOOT_IMAGE:-'"$image"'}|g' "$COMPOSE_FILE"

failure='could not start the new services'
CHATWOOT_IMAGE="$image" "${compose[@]}" up -d rails sidekiq

failure='health check failed within 5 minutes'
deadline=$((SECONDS + HEALTH_TIMEOUT))
while (( SECONDS < deadline )); do
  remaining=$((deadline - SECONDS))
  if curl -fsS --connect-timeout 5 --max-time "$((remaining < 10 ? remaining : 10))" \
    "$DOMAIN/api" > "$work_dir/health.json" &&
    jq -e 'type == "object" and has("version")' "$work_dir/health.json" >/dev/null; then
    remaining=$((deadline - SECONDS))
    if (( remaining > 0 )) &&
      [[ $(curl -sS --connect-timeout 5 --max-time "$((remaining < 10 ? remaining : 10))" \
        -o /dev/null -w '%{http_code}' "$DOMAIN/packs/js/sdk.js") == 200 ]]; then
      rollback_needed=false
      printf '%s\n' "$sha" > "$DEPLOY_DIR/deployed.sha.tmp"
      mv "$DEPLOY_DIR/deployed.sha.tmp" "$DEPLOY_DIR/deployed.sha"
      exit 0
    fi
  fi
  remaining=$((deadline - SECONDS))
  if (( remaining > 0 )); then
    sleep "$((remaining < 5 ? remaining : 5))"
  fi
done
exit 1
