# Автовыкладка Chatwoot EVIRMA

Сервер каждые пять минут проверяет вершину `evirma/main` через `git ls-remote`.
Новый SHA запускает сборку CE-образа на сервере, `db:chatwoot_prepare`,
перезапуск только `rails` и `sidekiq` и проверку `/api` (JSON с `version`) и
`/packs/js/sdk.js` (200) в течение пяти минут. Готовый образ повторно не собирается.
При ошибке запуска или проверки восстанавливаются прежние compose и образ.
Postgres и Redis не перезапускаются. Параллельный запуск отклоняется через `flock`.
Журнал: `/srv/docker/chatwoot/deploy-<дата>-<sha7>.log`, последняя строка —
`DEPLOY_OK <образ>` или `DEPLOY_FAIL <причина>`.

После успешной проверки здоровья SHA атомарно сохраняется в
`/srv/docker/chatwoot/deployed.sha`. `auto-deploy.sh` пропускает уже выкаченный SHA,
а также SHA из `failed.sha`: упавший коммит автоматически повторно не выкатывается,
следующий новый коммит выкатывается. Занятая блокировка тоже означает тихий пропуск;
проверка не держит блокировку при вызове `deploy.sh`, который берёт её сам.
Пропуски не пишут в журнал и не создают писем cron.

## Установка один раз

Нужны Linux, Bash, Docker с Compose v2, `git`, `curl`, `jq`, `flock` (util-linux),
`tar`, GNU `sed`, доступ сервера к форку и существующий проект `chatwoot` в
`/srv/docker/chatwoot` с `compose.evirma.yml`, `.env` и контейнером `chatwoot-rails-1`.
В compose у Rails и Sidekiq должен использоваться
`${CHATWOOT_IMAGE:-evirma/chatwoot:v4.18.0-evirma-<текущий тег>}`.
Не задавайте `CHATWOOT_IMAGE` в `.env`: сохранённый в compose тег должен оставаться
значением по умолчанию. Пути, домен, проект, репозиторий и префикс образа меняются
в начале `deploy.sh` и `auto-deploy.sh`; при смене каталога исправьте также пути
в cron и `ssh-entry.sh`.

Скопируйте скрипты и файл cron на сервер через существующий административный SSH-доступ:

```sh
scp deploy/evirma/deploy.sh deploy/evirma/auto-deploy.sh root@HOST:/srv/docker/chatwoot/
ssh root@HOST 'chmod 700 /srv/docker/chatwoot/deploy.sh /srv/docker/chatwoot/auto-deploy.sh'
scp deploy/evirma/cron.d-evirma-chatwoot-deploy root@HOST:/etc/cron.d/evirma-chatwoot-deploy
ssh root@HOST 'chmod 644 /etc/cron.d/evirma-chatwoot-deploy'
```

Cron должен быть запущен. Задание выполняется от `root`, PATH задан в файле cron,
вывод перенаправлен в `/dev/null`: журнал пишет сам скрипт. При первой проверке без
`deployed.sha` текущая вершина ветки будет выкачена.

Workflow `.github/workflows/evirma-deploy.yml` удалён, чтобы при восстановлении Actions
не возникла двойная выкладка. Секреты GitHub `EVIRMA_DEPLOY_SSH_KEY`,
`EVIRMA_DEPLOY_KNOWN_HOSTS`, `EVIRMA_DEPLOY_HOST`, `EVIRMA_DEPLOY_USER` и
`EVIRMA_DEPLOY_PORT` больше не нужны, их можно удалить.

## Журнал и повтор упавшего коммита

На сервере:

```sh
tail -f /srv/docker/chatwoot/auto-deploy.log
rm -f /srv/docker/chatwoot/failed.sha
```

Журнал содержит вывод выкладки и итог одной строкой: дата, SHA, `DEPLOY_OK` или
`DEPLOY_FAIL exit=<код>`. Ошибки получения SHA отмечаются `REMOTE_FAIL`.
Удаление `failed.sha` разрешает повтор текущего упавшего коммита при следующем
срабатывании cron. Отдельные подробные журналы `deploy-<дата>-<sha7>.log` сохраняются.
Скрипты и файл cron обновляются на сервере отдельно от исходников приложения.

## Ручная выкладка и откат

На сервере: `/srv/docker/chatwoot/deploy.sh <полный SHA из 40 hex-символов>`.
Снаружи ограниченным ключом: `ssh -i ./evirma-deploy-key root@HOST 'deploy <sha40>'`.
Для сохранения другого SHA временно отключите задание cron: иначе следующая проверка
вернёт вершину `evirma/main`. `build.sh` остаётся без изменений.

Для ручного запуска по ключу сохранён `ssh-entry.sh`. Если он ещё не установлен:

```sh
scp deploy/evirma/ssh-entry.sh root@HOST:/srv/docker/chatwoot/
ssh root@HOST 'chmod 700 /srv/docker/chatwoot/ssh-entry.sh'
ssh-keygen -t ed25519 -N '' -f ./evirma-deploy-key -C evirma-deploy
```

Добавьте **публичный** ключ `evirma-deploy-key.pub` отдельной строкой в
`/root/.ssh/authorized_keys`:

```text
command="/srv/docker/chatwoot/ssh-entry.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... evirma-deploy
```

Права: каталог `.ssh` — 700, `authorized_keys` — 600. Приватный ключ храните вне
репозитория. Ключ SSH-сервера сверяйте через доверенный административный доступ.

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

Локальные проверки (для проверки блокировки нужен `flock` из util-linux):

```sh
bash -n deploy/evirma/deploy.sh
bash -n deploy/evirma/auto-deploy.sh
bash deploy/evirma/test-auto-deploy.sh
bash deploy/evirma/test-ssh-entry.sh
```
