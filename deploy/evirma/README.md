# Автовыкладка Chatwoot EVIRMA

Push в `evirma/main` запускает сборку CE-образа на сервере, `db:chatwoot_prepare`,
перезапуск только `rails` и `sidekiq` и проверку `/api` (JSON с `version`) и
`/packs/js/sdk.js` (200) в течение пяти минут. Готовый образ повторно не собирается.
При ошибке запуска или проверки восстанавливаются прежние compose и образ.
Postgres и Redis не перезапускаются. Параллельный запуск отклоняется через `flock`.
Журнал: `/srv/docker/chatwoot/deploy-<дата>-<sha7>.log`, последняя строка —
`DEPLOY_OK <образ>` или `DEPLOY_FAIL <причина>`.

## Установка один раз

Нужны Linux, Bash, Docker с Compose v2, `git`, `curl`, `jq`, `flock` (util-linux),
`tar`, GNU `sed`, доступ сервера к форку и существующий проект `chatwoot` в
`/srv/docker/chatwoot` с `compose.evirma.yml`, `.env` и контейнером `chatwoot-rails-1`.
В compose у Rails и Sidekiq должен использоваться
`${CHATWOOT_IMAGE:-evirma/chatwoot:v4.18.0-evirma-<текущий тег>}`.
Не задавайте `CHATWOOT_IMAGE` в `.env`: сохранённый в compose тег должен оставаться
значением по умолчанию. Пути, домен, проект, репозиторий и префикс образа меняются
в начале `deploy.sh`; при смене каталога исправьте также путь в `ssh-entry.sh`.

Скопируйте оба скрипта на сервер через существующий административный SSH-доступ:

```sh
scp deploy/evirma/deploy.sh deploy/evirma/ssh-entry.sh root@HOST:/srv/docker/chatwoot/
ssh root@HOST 'chmod 700 /srv/docker/chatwoot/deploy.sh /srv/docker/chatwoot/ssh-entry.sh'
ssh-keygen -t ed25519 -N '' -f ./evirma-deploy-key -C github-evirma-deploy
```

Добавьте **публичный** ключ `evirma-deploy-key.pub` отдельной строкой в
`/root/.ssh/authorized_keys` (для другого пользователя — в его домашнем каталоге):

```text
command="/srv/docker/chatwoot/ssh-entry.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-evirma-deploy
```

Права: каталог `.ssh` — 700, `authorized_keys` — 600. Пользователь должен иметь
доступ к Docker и каталогу выкладки; по умолчанию используется `root`.
Файл `known_hosts.evirma` должен содержать ключ SSH-сервера для `HOST`, сверенный
с отпечатком через доверенный административный доступ. Слепо доверять результату
`ssh-keyscan` нельзя.

Из локальной копии форка заведите секреты GitHub (ключ и known_hosts читаются из файлов):

```sh
gh secret set EVIRMA_DEPLOY_SSH_KEY < ./evirma-deploy-key
gh secret set EVIRMA_DEPLOY_KNOWN_HOSTS < ./known_hosts.evirma
gh secret set EVIRMA_DEPLOY_HOST --body 'HOST'
gh secret set EVIRMA_DEPLOY_USER --body 'root'
gh secret set EVIRMA_DEPLOY_PORT --body 'PORT'
```

Для порта не 22 строка в `known_hosts.evirma` имеет вид `[HOST]:PORT ключ`.

Не добавляйте приватный ключ в репозиторий. После сохранения секрета уберите его
из рабочей копии в защищённое хранилище. Скрипты на сервере устанавливаются отдельно:
workflow передаёт только SHA и не обновляет `deploy.sh`/`ssh-entry.sh`.

## Ручная выкладка и откат

На сервере: `/srv/docker/chatwoot/deploy.sh <полный SHA из 40 hex-символов>`.
Снаружи ограниченным ключом: `ssh -i ./evirma-deploy-key root@HOST 'deploy <sha40>'`.
В GitHub Actions можно вызвать `Deploy EVIRMA Chatwoot` через Run workflow с полным SHA;
пустой ввод использует SHA выбранного запуска. `build.sh` остаётся без изменений.

Перед заменой compose сохраняется рядом как
`compose.evirma.yml.<дата>.<прежний тег>.bak`; имя копии видно в журнале при откате.
Для ручного отката выберите копию и прежний образ из журнала или `docker image ls`:

```sh
cd /srv/docker/chatwoot
(
  flock -n 9 || exit 1
  cp -p compose.evirma.yml.DATE.PREVIOUS_TAG.bak compose.evirma.yml
  CHATWOOT_IMAGE=evirma/chatwoot:PREVIOUS_TAG docker compose -p chatwoot -f compose.evirma.yml up -d rails sidekiq
) 9> deploy.lock
curl -fsS https://support.evirma.ru/api
curl -fsS -o /dev/null https://support.evirma.ru/packs/js/sdk.js
```

`db:chatwoot_prepare` определена в `lib/tasks/db_enhancements.rake`: для существующей
базы с `ar_internal_metadata` выполняет миграции, без повторной загрузки схемы и seed.
Миграции **не откатываются** при восстановлении образа и могут уже изменить базу,
даже если сама задача завершилась ошибкой. До выкладки нужна актуальная резервная
копия БД; несовместимые миграции требуют отдельного плана восстановления данных.
Старые образы и резервные compose автоматически не удаляются.

Локальная проверка входа SSH: `bash deploy/evirma/test-ssh-entry.sh`.
