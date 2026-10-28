# Правки EVIRMA поверх Chatwoot v4.18.0

## Тихий импорт SaleBot

`deploy/evirma/salebot/import.rb` — одноразовый rails runner для аккаунта 1: переносит
карточки Telegram/MAX из JSONL, атрибуты и метки воронки из CSV, историю и ссылки вложений.
Dry-run включён по умолчанию и не пишет в БД/Redis; запись разрешена только `--apply`.
Создание через `insert_all!`, обновление через `update_columns` обходят callbacks, отправки,
уведомления и события. Повторный запуск находит связи по source_id и пропускает сообщения
`salebot:*` во всех беседах ContactInbox. MAX mapping выгружается для `support.max_contact`.
Инструкция переключения ботов, московское время, проверки и откат —
`deploy/evirma/salebot/README.md`; синтетические входные данные — в соседнем `fixtures/`.
RSpec: `spec/evirma/evirma_salebot_import_spec.rb`, включая отсутствие заданий/событий и read-only
dry-run. При обновлении upstream сверить enum, Telegram source_id/chat_id, схему Tag/Tagging,
`cached_label_list`, ContactInbox pubsub_token и механизм кеша меток. Схема БД, штатные
исходники и `enterprise/` не меняются; новых зависимостей нет.

## Автовыкладка

`deploy/evirma/deploy.sh` собирает CE-образ заданного SHA (готовый образ переиспользует),
под блокировкой запускает штатную `db:chatwoot_prepare` и обновляет только Rails и Sidekiq.
Прежний образ определяется по работающему контейнеру; compose сохраняется с прежним тегом
в имени. Ошибка запуска или пятиминутной проверки API/SDK восстанавливает compose и образ.
Миграции базы при этом не откатываются. Каждый запуск пишет отдельный журнал с итогом
`DEPLOY_OK`/`DEPLOY_FAIL`; после успешной проверки здоровья SHA атомарно записывается
в `/srv/docker/chatwoot/deployed.sha`. Существующий серверный `build.sh` не меняется.

`auto-deploy.sh` запускается серверным cron от root каждые пять минут и получает вершину
`evirma/main` через `git ls-remote`. Уже выкаченный SHA, SHA из `failed.sha` и занятая
блокировка тихо пропускаются. Пробная блокировка снимается до вызова `deploy.sh`.
Ошибка выкладки сохраняет SHA в `failed.sha`; следующий новый коммит выкатывается,
ручной повтор разрешается удалением `failed.sha`. Вывод и итог с датой и SHA сохраняются
в `/srv/docker/chatwoot/auto-deploy.log`.

`cron.d-evirma-chatwoot-deploy` устанавливается в `/etc/cron.d/evirma-chatwoot-deploy`.
Workflow `.github/workflows/evirma-deploy.yml` удалён: Actions не создают запусков
в этом форке; секреты GitHub для выкладки больше не нужны и могут быть удалены.
`ssh-entry.sh` оставлен для ручного запуска: допускает только `deploy <sha40>`
и передаёт SHA без выполнения строки shell.
Установка, журнал, повтор, ручная выкладка и откат описаны в `deploy/evirma/README.md`.
`test-auto-deploy.sh` проверяет пропуски, успешную и неуспешную выкладку, блокировку
и отклонение неверного SHA; `test-ssh-entry.sh` — разрешённую команду, возврат её кода
и отказ посторонним командам.
Штатные исходники Chatwoot и `enterprise/` не меняются. При обновлении upstream проверить
Dockerfile, задачу подготовки базы и формат серверного compose.

CW1 добавляет постоянную панель EVIRMA над панелью контакта в правой колонке
разговора. Администратор аккаунта создаёт Dashboard App с точным названием
`evirma:right-panel` и содержимым
`[{"type":"frame","url":"https://..."}]`. Без такой записи панель не отображается.
EVIRMA: правая колонка открыта по умолчанию; крестик, кнопка контакта и Alt+O сохраняют выбор оператора.

| Штатный файл | Строки / суть | Зачем | Риск конфликта | Проверка после слияния upstream |
| --- | --- | --- | --- | --- |
| `app/controllers/api/v1/accounts/conversations/messages_controller.rb`, `app/jobs/telegram/message_update_job.rb`, `app/listeners/{action_cable_listener,evirma_contact_history_listener}.rb`, связанные Ruby specs | EVIRMA: проверки и сборка Telegram-запросов вынесены в приватные методы без изменения поведения; рассылка истории перенесена в `EvirmaContactHistoryListener`, штатные методы слушателя сохранены. Исправлены выравнивание и matcher `all`; spec слушателя переименован в `action_cable_listener_evirma_contact_history_spec.rb`. | Устранить замечания RuboCop из отчёта, сохранив проверки и HTTP внутри прежних блокировок. | Низкий: рефакторинг; Ruby-проверки требуют среды с зависимостями проекта. | Запустить RuboCop по затронутым Ruby-файлам и RSpec правки текста, Telegram и истории. |
| `app/javascript/widget/components/{AgentMessage,UserMessage}.vue` | EVIRMA: сообщение оператора использует штатный `DragWrapper` для ответа свайпом влево; обе кнопки ответа видны при `hover: none` через Tailwind. | Ответ оператору на телефоне доступен свайпом и кнопкой; история остаётся только для чтения. | Низкий: прежнее событие ответа и существующий порог свайпа, без изменения отправки. | Vitest: `widget/components/specs/AgentMessage.spec.js` — реальный touch-свайп и read-only; проверить кнопки на сенсорном устройстве. |
| `config/routes.rb`, `app/controllers/api/v1/accounts/conversations/messages_controller.rb`, `app/jobs/telegram/message_update_job.rb` | EVIRMA: отдельный `PATCH .../messages/:id/content`; проверка автора, исходящего сообщения/заметки, наличия текста, удаления и канала; сохранить `edited_at`, `previous_content` и остальные атрибуты. Telegram edit/delete через `telegram_api_url` в фоновой задаче; ошибки только в журнал. | Правка своего текста и удаление публичных исходящих Telegram-сообщений; текущий PATCH статуса не меняется. Штатный `message_updated` содержит `content` и `content_attributes`. | Средний: Telegram может отклонить правку/удаление, сохранённое действие Chatwoot не откатывается. Входящие и заметки в Telegram не удаляются. | RSpec: `evirma_message_content_spec.rb`, `telegram/message_update_job_spec.rb`. Проверить релей и применение вебхука на стороне MAX. |
| `app/models/channel/telegram.rb`, `app/services/telegram/send_on_telegram_service.rb`, `app/services/telegram/send_attachments_service.rb`, `app/jobs/telegram/message_update_job.rb`, `app/controllers/api/v1/accounts/conversations/messages_controller.rb` | EVIRMA: отправка сохраняет `telegram_message_ids` и отдельный `telegram_text_message_id`; удаление проходит по всем ID, правка выбирает текст или подпись, старые сообщения используют `source_id`. Задача держит блокировку сообщения от чтения актуального текста до завершения HTTP; повторный DELETE не ставит задачу. | Правка и удаление всего сообщения Telegram с альбомом и документами; устаревшая задача не возвращает прежний текст. | Средний: HTTP удерживает блокировку одной записи; ошибки внешнего API остаются в журнале. | RSpec: `telegram/message_update_job_spec.rb`, `evirma_message_content_spec.rb`; проверить полный цикл с текстом, альбомом, аудио и двумя документами, повторный DELETE и задачи в обратном порядке. |
| `Message.vue`, `MessageContextMenu.vue`, `ReplyBox.vue`, `WootWriter/Editor.vue`, `api/inbox/message.js`, `store/modules/conversations/actions.js`, `shared/constants/busEvents.js`, `MessageMeta.vue`, `widget/components/AgentMessage.vue`, переводы `dashboard/.../{en,ru}/conversation.json`, `widget/.../{en,ru}.json`, `config/locales/{en,ru}.yml` | EVIRMA: видимая при наведении кнопка «⋯», пункт Edit/«Изменить», правка в штатном редакторе с отменой крестиком/Esc и восстановлением черновика; вложения и встроенная загрузка изображений недоступны через `enableImageUpload`. Подпись edited/«изменено» у времени в панели и виджете. JSON не поддерживает комментарии: метка форка — ключ `EVIRMA_MESSAGE_EDIT`. | Оператор находит меню и меняет отправленный текст без создания нового сообщения. Русский перевод поддерживается форком по прямому требованию задачи. | Средний: при обновлении редактора сохранить отдельное состояние правки и черновика. | Vitest: `MessageEditing.spec.js`, `ReplyBox.spec.js`, `WootWriter/Editor.spec.js`, `WidgetDates.spec.js`, `auth/getters.spec.js`; вручную проверить кнопки, Esc, заметки и ошибки сохранения. |
| `app/services/widget/contact_history.rb`, `app/listeners/action_cable_listener.rb`, `widget/helpers/actionCable.js`, `widget/store/modules/contactHistory.js` | EVIRMA: не выдавать удалённое в HTTP-истории через распаковку JSON store `(content_attributes #>> '{}')::jsonb`; `reorder` выбирает последние 100 записей вопреки default scope, передавать `content_attributes`, отдельно рассылать `contact.history_message.updated` для правок/удалений. Сохранить границы контакта/аккаунта; изменения во время загрузки имеют приоритет над старым ответом. | Изменения видны сразу, удалённое не возвращается после загрузки и переподключения; уведомления о новом сообщении не дублируются. | Средний: новый тип события общей истории. | RSpec: `contact_history_controller_spec.rb`, `action_cable_listener_evirma_contact_history_spec.rb`; Vitest: `contactHistory.spec.js`, `actionCable.spec.js`. |
| `app/javascript/dashboard/store/modules/auth.js`, `app/javascript/dashboard/components-next/Conversation/SidepanelSwitch.vue`, `app/javascript/dashboard/components/widgets/conversation/ConversationSidebar.vue`, `app/javascript/dashboard/routes/dashboard/conversation/ContactPanel.vue` | EVIRMA: `true` только по умолчанию; сохранённое `false` учитывается. Возвращены кнопка контакта, Alt+O и штатный крестик; группа кнопок не зависит от Captain. Колонка остаётся в общем ряду без наложения, закрытие снаружи не возвращается. | Оператор может закрыть и открыть панель контакта и Evirma. | На узком экране открытая колонка занимает часть ширины. Проверить при изменениях настроек и боковых панелей upstream. | Vitest: `auth/getters.spec.js`, `Conversation/specs/SidepanelSwitch.spec.js`, `conversation/specs/EvirmaPanel.spec.js`. Проверить крестик, кнопку и Alt+O с Captain и без; перезагрузить со старым `false`. |
| `app/javascript/dashboard/components-next/message/bubbles/Video.vue` | EVIRMA: щелчок по видео открывает штатный `GalleryView` с воспроизведением. Для изображений и миниатюр использован уже существующий просмотр; новая галерея не добавляется. | Просмотр изображения и видео в модальном окне; ссылки скачивания остальных файлов сохранены. | Низкий: воспроизведение видео перенесено из пузыря в галерею. | Vitest: `message/bubbles/specs/MediaGallery.spec.js`: изображения, видео, миниатюры, закрытие и ссылка документа. |
| `app/javascript/widget/views/Messages.vue`, `app/javascript/widget/components/{ChatAttachment,ChatInputWrap}.vue`, `app/javascript/widget/i18n/locale/{en,ru}.json` | EVIRMA: штатный `vue-upload-component` принимает несколько файлов над лентой и полем ввода, показывает подсветку `EVIRMA_DROP_TO_SEND`; переход браузера к файлу отменён. Обработчик скрепки остаётся смонтированным при наборе текста, поэтому вставка картинки работает и с черновиком. Для всех способов действуют типы `ALLOWED_FILE_TYPES` и настроенный предел размера. | Перетаскивание фото, видео и документов и вставка изображений используют существующую отправку вложений, включая прямую загрузку. | Низкий: используются существующие разрешения загрузки, обработчики и библиотека. Перевод ru добавлен явно по просьбе владельца; JSON не поддерживает комментарии, метка находится в имени ключа и здесь. | Vitest: `widget/views/specs/MessageAttachments.spec.js`: оба языка, несколько файлов, черновик, прямая загрузка, размер, запрещённый тип, отключённая загрузка и обычный текст из буфера. |
| `app/models/conversation.rb`, `app/models/message.rb` | EVIRMA: беседа ongoing-кампании создаётся в `pending`; любое неприватное входящее сообщение открывает pending-беседу с кампанией и без неё через штатный `open!`. Приватные входящие не открывают pending-, snoozed- и resolved-беседы. | Не занимать операторов беседами кампаний, пока клиент не ответил, и не считать скрытый Telegram `/start` ответом клиента. | Используются штатные обработчики статуса и назначения. При подключении agent bot, который удерживает беседы в `pending`, нужно пересмотреть правило открытия любой pending-беседы по неприватному входящему. Старые открытые беседы не изменяются. | `bundle exec rspec spec/builders/campaigns/campaign_conversation_builder_spec.rb spec/models/conversation_spec.rb spec/models/message_spec.rb`: ожидание без назначения до ответа; открытие кампанийной и обычной pending-беседы по неприватному входящему; сохранение pending, snoozed и resolved для приватного входящего; разовая кампания. |
| `app/javascript/widget/components/{EvirmaContactHistory,ChatMessage,AgentMessage,UserMessage}.vue`, `app/services/widget/contact_history.rb`, `app/services/telegram/incoming_message_service.rb`, `app/javascript/widget/{App.vue,composables/useAvailability.js,helpers/availabilityHelpers.js}`, `app/javascript/sdk/IFrameHelper.js` | EVIRMA: история использует штатные пузыри и разделители дат, значок канала без имени канала, боты и ответы без автора показаны как Evirma; входящий `/start…` сохраняется приватно ради вебхука; событие доступности содержит `isOnline`, `isOutOfOffice`, `opensAt`, SDK передаёт все поля. | Единая лента, скрытые служебные команды и рабочее расписание для страницы кабинета. | Средний: история остаётся только для чтения, обычные ответы сохраняют управление; проверить при обновлении форматы автора и рабочих часов. Системный User без отдельного признака неотличим от оператора. | Vitest: история, даты, событие и SDK; ESLint изменённых файлов. RSpec: Telegram и API истории. Вебхук должен принимать `private: true`; обработчик бэкенда Evirma в этой рабочей копии отсутствует. |
| `app/javascript/widget/components/{EvirmaContactHistory,ConversationWrap,DateSeparator,AgentMessage,UserMessage,AgentMessageBubble,AgentTypingBubble}.vue`, `app/javascript/widget/composables/useWidgetDate.js` | EVIRMA: история раскрыта по умолчанию; даты и время берут локаль i18n через штатный `useLocale` и `Intl`; пузырь оператора — `bg-n-slate-4 dark:bg-n-slate-6`. | При `ru` показывать `ДД.ММ.ГГГГ`, 24-часовое время и штатные «Сегодня»/«Вчера»; сохранить сворачивание истории. Фон оператора: светлый `#FDFDFD` → `#E8E8EC`, тёмный `#2C2D36` → `#363A3F`; фон ленты `#F9F9FB` / `#17171A` и цвет клиента из `widget_color` сохранены. | Низкий: только виджет; формат меняется при смене локали, время остаётся в часовом поясе браузера. | `node_modules/.bin/vitest run app/javascript/widget/components/specs/EvirmaContactHistory.spec.js app/javascript/widget/components/specs/WidgetDates.spec.js`; вручную сравнить светлую и тёмную темы. |
| `app/javascript/entrypoints/sdk.js`, `app/javascript/sdk/IFrameHelper.js`, `app/javascript/widget/store/modules/appConfig.js`, `app/javascript/widget/views/Home.vue`, `app/javascript/widget/components/layouts/ViewWithHeader.vue` | EVIRMA: булева настройка `window.chatwootSettings.skipHome`, по умолчанию `false`, проходит через SDK и `config-set`; главный экран сразу запускает штатный переход к беседе после загрузки сообщений, кнопка возврата на главную скрыта. | Встроенный виджет сразу показывает ленту и поле ввода либо предварительную форму, если она включена для новой беседы. Готовый `ConversationWrap` показывает историю других каналов и без текущей беседы. | Низкий: используется штатный переход `startConversation`, без изменения предварительной формы и `enterprise/`. | Проверить `skipHome: true`, `false` и отсутствие настройки: новая и существующая беседа, предварительная форма, поздний `config-set`, повторное открытие, история других каналов и кнопка назад. |
| `config/routes.rb`, `app/listeners/action_cable_listener.rb` | EVIRMA: маршрут `GET /api/v1/widget/contact_history` и вызов `Widget::ContactHistory` после штатного `message.created`. | Последние 100 публичных входящих/исходящих сообщений идентифицированного контакта из других каналов того же аккаунта; отдельное событие `contact.history_message.created` на веб-каналы этого контакта. | Низкий: два места подключения; проверять авторизацию виджета и штатный обработчик сообщений после обновления. | Запросить историю своим и чужим токеном, гостем; проверить исключение заметок, служебных сообщений и текущего канала. Ответить в MAX/Telegram/почте: сообщение появляется без перезагрузки только у своего контакта. |
| `app/javascript/widget/components/ConversationWrap.vue`, `app/javascript/widget/store/index.js`, `app/javascript/widget/store/modules/contacts.js` | EVIRMA: подключить отдельные компонент и хранилище истории; сбрасывать историю при `setUser` и загружать с обновлённым токеном. | Сворачиваемая история перед текущей беседой; ограничение 100 сообщений, защита от восстановления прежнего контакта запоздавшим запросом. | Низкий: новые импорты и вызовы, штатные сообщения хранятся отдельно. | Открыть беседу, свернуть и развернуть историю; открыть виджет повторно; сменить контакт через SDK во время загрузки истории. |
| `app/javascript/widget/helpers/actionCable.js`, `app/views/widgets/show.html.erb` | EVIRMA: передавать `inboxId`, исключать чужие каналы из штатных событий, обрабатывать отдельное событие истории и обновлять её после переподключения. | Избежать смешивания бесед и двойных уведомлений при штатной HMAC-рассылке. Исходящие сообщения истории вызывают `chatwoot:on-message` через штатный `IFrameHelper`. | Средний: при смене способа настройки виджета нужно сохранить `inboxId`. | С HMAC и без него, в том числе без текущей веб-беседы: один ответ из другого канала — одно событие родителю; ответ текущего канала идёт штатным путём. Восстановить соединение и проверить пропущенные сообщения. |
| `app/javascript/widget/i18n/locale/en.json` | EVIRMA: исходная строка `EVIRMA_CONTACT_HISTORY.TITLE`; JSON не допускает комментариев, поэтому метка вынесена сюда и в имя ключа. | Заголовок «История из других каналов», английский источник `History from other channels`. | Низкий. | Переводы остальных языков, включая русский, поступают через Crowdin по правилам проекта. |
| `app/javascript/dashboard/components/widgets/conversation/ConversationSidebar.vue` | Импорт `EvirmaPanel` рядом с другими импортами; компонент перед прокручиваемым `ContactPanel`. Обе правки помечены `EVIRMA:`. | Отображать приложение над контактом без изменения `activeTab` и скрытия колонки. | Низкий: три добавленные строки; проверить перенос или перестройку правой колонки. | Открыть два разговора по очереди: iframe сверху, контакт ниже прокручивается; колонка закрывается штатным крестиком и вновь открывается кнопкой контакта. Удалить приложение: панель исчезает, штатный интерфейс сохраняется. |
| `app/javascript/dashboard/components/widgets/conversation/ConversationSidebar.vue` | Импорт `EvirmaPanel`; компонент перед `ContactPanel` в общей прокручиваемой колонке, вне аккордеонов. Правки помечены `EVIRMA:`. | Панель всегда развёрнута независимо от сохранённых состояний секций; контакт доступен прокруткой даже при высокой панели. | Низкий: проверить перенос или перестройку правой колонки. | Открыть два разговора по очереди с сохранёнными свёрнутыми секциями: iframe открыт сверху, контакт доступен ниже; колонка закрывается штатным крестиком и вновь открывается кнопкой контакта. Удалить приложение: панель исчезает, штатный интерфейс сохраняется. |
| `app/javascript/dashboard/components/widgets/conversation/EvirmaPanel.vue` | Высота `calc(100vh - 4rem)`, минимум `56.25rem` (900 px). Правка помечена `EVIRMA:`. | Увеличить рабочую область приложения; не добавлять отдельную прокрутку вокруг iframe. | Низкий: свой компонент форка. | Проверить короткое и высокое окно: рамка не ниже 900 px, контакт доступен общей прокруткой колонки. |
| `app/javascript/dashboard/components/widgets/conversation/ConversationBox.vue` | Получать исходный список как `allDashboardApps`; вычислять `dashboardApps`, исключая точное название `evirma:right-panel`. Правка помечена `EVIRMA:`. | Исключить приложение одновременно из вкладок, центральных фреймов и проверки наличия вкладок; сохранить их индексы. | Низкий: одна заменённая строка и пять добавленных; проверить изменения штатного списка Dashboard Apps. | Добавить обычные приложения до и после EVIRMA: вкладки открывают правильные страницы. Если есть только EVIRMA, центральные вкладки отсутствуют. Без EVIRMA обычные вкладки работают как прежде. |
| `app/controllers/api/v1/widget/conversations_controller.rb` | `set_custom_attributes`: объединять присланные атрибуты разговора с уже сохранёнными вместо замены. Правка помечена `EVIRMA:`. | Кабинет EVIRMA (`project_id`, `page`) и расширение (`wb_page_url`, `extension_version`) пишут в один разговор разные ключи и не должны стирать друг друга. Удаление ключа — штатный `destroy_custom_attributes`. | Низкий: одна строка. | `spec/controllers/api/v1/widget/conversations_controller_spec.rb`, случай `keeps previously set attributes`. |
| `app/models/channel/telegram.rb` | Единый адрес Bot API из `TELEGRAM_API_URL` для запросов и скачивания файлов; адрес `setWebhook` из `TELEGRAM_WEBHOOK_BASE_URL` с прежним `FRONTEND_URL` по умолчанию. Правки помечены `EVIRMA:`. | Сервер в РФ не достаёт Telegram напрямую; запросы и входящие вебхуки проходят через релей. | Низкий: настройки необязательны и сохраняют прежние адреса по умолчанию. | `spec/models/channel/telegram_spec.rb`: проверить запросы Bot API, адрес файла и адрес `setWebhook` с настройками и без них. |
| `app/javascript/entrypoints/sdk.js` | Читать булеву настройку `window.chatwootSettings.hideHeader`, по умолчанию `false`. Правка помечена `EVIRMA:`. | Позволить родительской странице скрывать шапку виджета. | Низкий: дополнительная настройка SDK. | Проверить запуск SDK с `hideHeader: true`, `false` и без настройки. |
| `app/javascript/sdk/IFrameHelper.js` | Передавать `hideHeader` в `config-set`; превращать `availability-changed` в событие окна `chatwoot:availability-changed` с `detail: { isOnline }`. Обе правки помечены `EVIRMA:`. | Передать настройку в рамку и дать внешней странице текущий статус операторов. | Низкий: поле настройки и отдельный обработчик события. | Проверить содержимое `config-set` и подписку внешней страницы на событие для обоих значений статуса. |
| `app/javascript/widget/store/modules/appConfig.js` | Хранить `hideHeader` со значением `false` по умолчанию; принимать его через штатные действие и изменение состояния. Правки помечены `EVIRMA:`. | Сохранить настройку скрытия шапки в общем хранилище виджета. | Низкий: одно дополнительное поле. | Передать `config-set` с `hideHeader: true`, затем без настройки: значение возвращается к `false`. |
| `app/javascript/widget/components/layouts/ViewWithHeader.vue` | Не создавать общий контейнер большой и компактной шапок при `appConfig.hideHeader`. Правка помечена `EVIRMA:`. | Скрыть обе шапки на главном экране и в разговоре. | Низкий: одно условие на существующем контейнере. | С `hideHeader: true` обе шапки отсутствуют; без настройки отображается прежняя шапка для текущего экрана. |
| `app/javascript/widget/App.vue` | Наблюдать штатный `useAvailability` с операторами из хранилища; после успешной загрузки отправить `{ event: 'availability-changed', isOnline }`, затем отправлять только при смене значения. Правки помечены `EVIRMA:`. | Сообщать статус независимо от экрана и видимости шапки, учитывая штатные рабочие часы. | Низкий: наблюдатель в существующем `setup`; сверить признаки загрузки операторов при обновлении upstream. | Проверить первое событие для пустого и непустого списка операторов, смену присутствия, отсутствие повторов и ожидание успешной загрузки после ошибки. |
| `app/javascript/widget/helpers/availabilityHelpers.js` | `isOnline`: при включённых рабочих часах возвращать состояние расписания, не проверяя присутствие операторов. Правка помечена `EVIRMA:`. | Считать виджет «в сети» в рабочее время канала независимо от присутствия операторов; без расписания сохранить статус операторов. | Низкий: меняется только ветка с включёнными рабочими часами. | `app/javascript/widget/helpers/specs/availabilityHelpers.spec.js`: внутри расписания `true` без операторов, вне расписания `false`, без расписания — по статусу операторов. |
| `app/javascript/widget/store/modules/agent.js` | Использовать кэш списка операторов не дольше 60 секунд. Правка помечена `EVIRMA:`. | Не отправлять наружу устаревший статус доступности из общего суточного кэша. | Низкий: срок задан только для кэша операторов. | Проверить повторную загрузку после истечения 60 секунд и использование свежего кэша. |
| `app/javascript/widget/App.vue` | Повторно запрашивать операторов раз в 60 секунд и очищать таймер при удалении виджета. Правки помечены `EVIRMA:`. | Обновлять событие `availability-changed`, когда событие присутствия не пришло по вебсокету. | Низкий: один таймер на время жизни виджета. | Проверить запрос по таймеру и остановку запросов после закрытия виджета. |

Своя реализация находится в
`app/javascript/dashboard/components/widgets/conversation/EvirmaPanel.vue`,
проверки — в соседнем `specs/EvirmaPanel.spec.js`.
Штатный `DashboardApp/Frame.vue` используется без изменений: он передаёт
`appContext`, контакт, агента, определения атрибутов и тему.
Позиция `-1` отличает iframe от штатных вкладок. При смене разговора Frame
пересоздаётся. Видимость включается после обновления Vue, чтобы сработал
штатный наблюдатель `isVisible`, в том числе при поздней загрузке приложения.
Панель всегда развёрнута: переключателя нет, состояния аккордеонов не читаются.
Высота панели — `calc(100vh - 4rem)`, минимум `56.25rem` (900 px).
Панель и контакт используют общую прокрутку колонки. Прокрутка содержимого
iframe зависит от внешней страницы; она должна разрешать встраивание.

После обновления upstream проверить договор Frame: свойства `config`,
`currentChat`, `position`, `isVisible`, открытие при изменении `isVisible`,
высоту `100%`, идентификаторы iframe и отправку `appContext` после загрузки.
На внешней странице убедиться, что контекст содержит текущий разговор и его
контакт после перехода между разговорами.

Команда проверки для координатора:
`pnpm test app/javascript/dashboard/components/widgets/conversation/specs/EvirmaPanel.spec.js`.
Дополнительно запустить штатный
`app/javascript/dashboard/components/widgets/DashboardApp/specs/Frame.spec.js`.

Проверки скрытия шапки и доступности операторов:
`pnpm vitest run app/javascript/entrypoints/sdk.spec.js app/javascript/sdk/specs/IFrameHelper.spec.js app/javascript/widget/components/specs/ViewWithHeader.spec.js app/javascript/widget/specs/App.spec.js`.
На внешней странице настройка задаётся до `chatwootSDK.run`:
`window.chatwootSettings = { hideHeader: true }`.
Статус доступен через `window.addEventListener('chatwoot:availability-changed', event => event.detail.isOnline)`.
EVIRMA: `detail` также содержит `isOutOfOffice` и `opensAt` (`HH:mm` в часовом поясе канала).
Если рабочие часы выключены, передаются `false` и `null`; если ближайшего открытия нет — `opensAt: null`.
Расписание пересчитывается существующим минутным опросом; событие отправляется при изменении любого поля.

EVIRMA: история клиента из других каналов реализована в новых файлах
`app/controllers/api/v1/widget/contact_history_controller.rb`,
`app/services/widget/contact_history.rb`,
`app/javascript/widget/api/contactHistory.js`,
`app/javascript/widget/store/modules/contactHistory.js`,
`app/javascript/widget/components/EvirmaContactHistory.vue`.
Авторизация использует штатные `website_token` и `X-Auth-Token`, контакт берётся
только из найденного `contact_inbox`; переданные клиентом идентификаторы контактов
не используются. Требуется непустой `identifier`. Входящие и исходящие сообщения
имеют строковый `message_type` в API истории. Для события родительской странице
исходящий тип приводится к штатному числу `1`, сохраняются `sender_type`,
`conversation_id`, `inbox_id` и `account_id`.
Вложения используют штатный `Attachment#push_event_data`, в блоке доступны ссылки
для их открытия. Текст выводится с экранированием, без элементов ответа и редактирования.
Новые запросы и трансляция используют общий отбор сообщений. `enterprise/` не меняется.

Проверки истории:
`node_modules/.bin/vitest run app/javascript/widget/components/specs/EvirmaContactHistory.spec.js app/javascript/widget/helpers/specs/evirmaContactHistory.spec.js app/javascript/widget/store/modules/specs/contactHistory.spec.js app/javascript/widget/helpers/specs/actionCable.spec.js app/javascript/widget/store/modules/specs/contact/actions.spec.js`.
Проверки сервера после подготовки Ruby/Bundler и тестовой базы:
`bundle exec rspec spec/controllers/api/v1/widget/contact_history_controller_spec.rb spec/listeners/action_cable_listener_evirma_contact_history_spec.rb spec/listeners/action_cable_listener_spec.rb`.
Вручную проверить ответ из каждого канала, открытие вложений, повторное открытие
виджета, переподключение, переключение пользователя через SDK и подписку расширения
на `chatwoot:on-message`. Без `identifier` блока быть не должно.

## SDK для расширения Evirma: токен, мессенджеры и адрес страницы

| Файл | Место и назначение правки | Контракт / поведение | Риск при обновлении upstream | Проверка |
| --- | --- | --- | --- | --- |
| `app/javascript/entrypoints/sdk.js`, `app/javascript/sdk/IFrameHelper.js` | EVIRMA: внешний токен разговора, события токена, защита сообщений и адрес страницы. | Наличие `window.chatwootSettings.conversationToken` (`string` или `null`) отключает чтение, запись и удаление cookies идентификации SDK. Непустой или пустой строковый токен передаётся в `cw_conversation` адреса рамки с URL-кодированием; `null` не добавляется. Cookies срока скрытия кампаний сохраняют штатное поведение. `chatwoot:conversation-token` с `detail: { token }` отправляется при `loaded`, `setAuthCookie` и `reset()` (последний передаёт `null`) в обоих режимах. Сообщения принимает отдельный `message` listener только от `iframe.contentWindow` и origin настроенного `baseUrl`. | Средний: при обновлении проверить новые места работы с cookies идентификации и события загрузки/смены пользователя. | SDK-спеки: внешний токен и `null`, кодирование, сохранение штатных cookies, смена токена, reset, popout, ошибка идентификации и чужой источник/origin. |
| `app/javascript/entrypoints/sdk.js`, `app/javascript/sdk/IFrameHelper.js`, `app/javascript/widget/App.vue` | EVIRMA: передавать `pageUrl` в существующие сообщения без изменения правил кампаний. | `window.chatwootSettings.pageUrl` — абсолютный адрес внешней страницы. Он заменяет `referrerURL` и `referrerHost` в `config-set` и `change-url`; `$chatwoot.setPageUrl(url)` сразу отправляет `change-url`. В виджете начальный адрес сохраняется до загрузки разговоров; кампании запускаются штатным `change-url`, без повторного запроса из `config-set`. Без настройки сохраняется прежняя атрибуция страницы. | Низкий: сохранить порядок начальной конфигурации и обработки смены адреса. | Проверить адрес до загрузки разговоров, параметры кампаний, смену адреса через SDK и отсутствие влияния URL страницы расширения. |
| `app/javascript/widget/store/modules/appConfig.js`, `app/javascript/widget/components/MessengerButtons.vue`, `app/javascript/widget/components/ChatHeader.vue`, `app/javascript/widget/components/ChatHeaderExpanded.vue` | EVIRMA: кнопки продолжения в родных шапках через общий компонент. | `window.chatwootSettings.messengerButtons: Array<'telegram' \| 'max'>` доставляется через `config-set` и `appConfig`, по умолчанию `[]`. Кнопки отправляют только сообщение `messenger-requested`; SDK поднимает `chatwoot:messenger-requested` с `detail: { channel: 'telegram' \| 'max' }`. Сетевых запросов и открытия мессенджеров в обработчике нет — дальнейшее действие выбирает расширение. | Низкий: проверить места подключения обеих родных шапок и маршрут `config-set`. | Обе шапки без настройки, с одной/двумя кнопками, сброс настройки, оба события. |
| `app/javascript/widget/App.vue`, `app/javascript/widget/composables/useAvailability.js`, `app/javascript/widget/components/Availability/AvailabilityContainer.vue`, обе шапки | EVIRMA: использовать существующие расчёт доступности и минутный таймер приложения. | При `isOutOfOffice && opensAt` показывается «Откроемся утром в {opensAt}», где `opensAt` — `HH:mm` в часовом поясе канала. Общий ключ `EVIRMA_AVAILABILITY_TIME` передаёт часы через `provide/inject`; отдельного таймера нет. Без расписания или известного открытия остаётся штатный текст. Действует в обоих виджетах без дополнительной настройки. | Низкий: при смене опроса доступности сохранить общие часы события и шапок. | Проверить переход к рабочему времени по общим часам, неизвестное открытие, выключенное расписание и часовой пояс канала. |
| `app/javascript/widget/i18n/locale/en.json`, `app/javascript/widget/i18n/locale/ru.json` | EVIRMA: ключи `EVIRMA_OPENS_AT`, `EVIRMA_MESSENGERS.TELEGRAM`, `EVIRMA_MESSENGERS.MAX`; JSON не поддерживает комментарии, метка вынесена сюда и в имена ключей. | Английские и русские подписи добавлены по явному требованию карточки расширения. | Низкий. | Компонентные спеки проверяют русские и английские подписи. |

Проверки SDK и виджета (включая штатные спеки затронутых компонентов и хранилища):

```sh
TZ=UTC node_modules/.bin/vitest run app/javascript/entrypoints/sdk.spec.js app/javascript/sdk/specs/IFrameHelper.spec.js app/javascript/sdk/specs/cookieHelpers.spec.js app/javascript/widget/specs/App.spec.js app/javascript/widget/components/specs/EvirmaHeader.spec.js app/javascript/widget/components/specs/ViewWithHeader.spec.js app/javascript/widget/components/specs/RtlDirectionalIcons.spec.js app/javascript/widget/store/modules/specs/appConfig app/javascript/widget/composables/specs/useAvailability.spec.js app/javascript/widget/helpers/specs/availabilityHelpers.spec.js
node_modules/.bin/eslint app/javascript/entrypoints/sdk.js app/javascript/entrypoints/sdk.spec.js app/javascript/sdk/IFrameHelper.js app/javascript/sdk/specs/IFrameHelper.spec.js app/javascript/widget/App.vue app/javascript/widget/specs/App.spec.js app/javascript/widget/components/ChatHeader.vue app/javascript/widget/components/ChatHeaderExpanded.vue app/javascript/widget/components/MessengerButtons.vue app/javascript/widget/components/Availability/AvailabilityContainer.vue app/javascript/widget/components/specs/EvirmaHeader.spec.js app/javascript/widget/store/modules/appConfig.js app/javascript/widget/composables/useAvailability.js
```

## Доработки SDK расширения Evirma: безопасность, создание беседы и уведомления

- F8 — EVIRMA: Opening the panel on the existing `messages` route marks messages as read and emits `chatwoot:unread-count` with count 0; regression covered in `app/javascript/widget/specs/App.spec.js`.

| Файл | Место и назначение правки | Контракт / поведение | Риск при обновлении upstream | Проверка |
| --- | --- | --- | --- | --- |
| `app/javascript/sdk/IFrameHelper.js` | EVIRMA: общий расчёт доверенного origin для приёма и отправки сообщений. | SDK отправляет сообщения, включая `set-user` с подписью, только в `new URL(window.$chatwoot.baseUrl).origin`, сохраняя проверку source/origin входящих сообщений. | Низкий: сохранять общий расчёт origin в обе стороны. | Проверки чужих source/origin и отправки на origin с нестандартным портом. |
| `app/javascript/entrypoints/sdk.js`, `app/javascript/sdk/{settingsHelper,IFrameHelper}.js` | EVIRMA: проверка внешнего адреса на входе. | Невалидные `chatwootSettings.pageUrl` и аргумент `setPageUrl` игнорируются с `console.warn`; последняя корректная атрибуция сохраняется, загрузка и `chatwoot:ready` продолжаются. Корректный абсолютный URL нормализуется стандартным `URL`. | Низкий. | Невалидные относительный адрес, строка, пустое значение, null и число; config-set и ready после отклонения URL. |
| `app/javascript/entrypoints/sdk.js`, `app/javascript/sdk/IFrameHelper.js`, `app/javascript/widget/{App.vue,views/Campaigns.vue}` | EVIRMA: полное отключение cookies SDK при внешнем токене и публикация отсрочки кампаний. | Наличие ключа `conversationToken`, включая null, отключает чтение/запись/удаление `cw_conversation`, `cw_user_<websiteToken>` и `cw_snooze_campaigns_till`. Внешний режим получает отметку из `chatwootSettings.campaignsSnoozedTill`: число миллисекунд Unix (`Number(Date)`). При каждой установке отсрочки во всех режимах SDK публикует `chatwoot:campaigns-snoozed`, `detail: { till }`; одинаковая отметка используется виджетом и SDK. Повторный внешний setUser снова отправляется на сервер. | Средний: следить за новыми местами доступа к cookies SDK; это уточнение заменяет прежнее правило о сохранении cookie кампаний. | Внешний и штатный режимы, начальная отметка, повторная отсрочка, повторный setUser, reset, popout и ошибка идентификации. |
| `app/javascript/entrypoints/sdk.js`, `app/javascript/sdk/IFrameHelper.js`, `app/javascript/widget/store/modules/{appConfig.js,conversation/actions.js,campaign.js}`, `app/javascript/widget/api/endPoints.js` | EVIRMA: постоянные defaults атрибутов для создания беседы через штатные API. | `chatwootSettings.conversationCustomAttributes: object` проходит через config-set/appConfig в запрос создания беседы: prechat, первый текст (включая retry), первое вложение или исполнение кампании. Атрибуты формы/явного setter имеют приоритет над defaults. После определения существующей беседы defaults не передаются. Сервер сохраняет их только при создании, до первого сообщения; отдельного запроса обновления нет. Multipart использует установленный Axios для вложенных объектов и списков атрибутов. | Средний: сохранить все пути создания и повторной отправки. Серверные изменения не нужны: BaseController уже сохраняет custom_attributes, ConversationsController и MessagesController их разрешают, CampaignConversationBuilder также поддерживает их. Текущий setConversationCustomAttributes в форке дополняет атрибуты через shallow merge, заменяя совпавшие ключи. | Store/API-проверки всех путей, сброс prechat, приоритет атрибутов, retry, существующая беседа и multipart. |
| `app/javascript/sdk/IFrameHelper.js`, `app/javascript/widget/App.vue` | EVIRMA: события непрочитанного и скрытых кампаний. | `chatwoot:unread-count`, `detail: { count }` публикуется при загрузке сообщений, изменении количества и прочтении, включая 0; скрытая кнопка не мешает событию. При `hideMessageBubble: true` и `showUnreadMessagesDialog: false` подходящая несокрытая кампания приходит через `chatwoot:on-message` без открытия рамки: `{ content, sender, sender_type: 'User', message_type: 1, attachments: [], campaignId, is_campaign: true }`. Это предпросмотр кампании, а не сохранённое сообщение: у него нет message id/conversation id. Операторские сообщения уже доставляются независимо от открытости виджета: штатный payload с `content`, `sender`, `sender_type`, `attachments` при наличии; у сохранённых сообщений кампании идентификатор находится в `additional_attributes.campaign_id`. Кампании не включаются в счётчик до появления сообщения в беседе. | Средний: сохранить eligibility кампаний (нет сообщений, не отложена), счётчик и начальное событие после загрузки. Без указанной комбинации настроек показ кампаний прежний. | Начальное 0, ответ оператора, переход к 0 после прочтения, скрытая кампания без навигации/открытия, отложенная кампания и беседа с сообщениями. |

Проверки доработок и существующих SDK/виджетных путей:

```sh
TZ=UTC node_modules/.bin/vitest run app/javascript/entrypoints/sdk.spec.js app/javascript/sdk/specs app/javascript/widget/specs/App.spec.js app/javascript/widget/store/modules/specs/initialConversationAttributes.spec.js app/javascript/widget/store/modules/specs/appConfig app/javascript/widget/store/modules/specs/conversation app/javascript/widget/store/modules/specs/campaign app/javascript/widget/api/specs/endPoints.spec.js app/javascript/widget/views/specs/PreChatForm.spec.js app/javascript/widget/helpers/specs/actionCable.spec.js app/javascript/widget/helpers/specs/evirmaContactHistory.spec.js
node_modules/.bin/eslint app/javascript/entrypoints/sdk.js app/javascript/entrypoints/sdk.spec.js app/javascript/sdk/IFrameHelper.js app/javascript/sdk/settingsHelper.js app/javascript/sdk/specs/IFrameHelper.spec.js app/javascript/widget/App.vue app/javascript/widget/specs/App.spec.js app/javascript/widget/views/Campaigns.vue app/javascript/widget/store/modules/appConfig.js app/javascript/widget/store/modules/conversation/actions.js app/javascript/widget/store/modules/campaign.js app/javascript/widget/store/modules/specs/conversation/actions.spec.js app/javascript/widget/store/modules/specs/campaign/actions.spec.js app/javascript/widget/store/modules/specs/initialConversationAttributes.spec.js app/javascript/widget/helpers/specs/actionCable.spec.js app/javascript/widget/api/endPoints.js app/javascript/widget/api/specs/endPoints.spec.js
```

Ruby не меняется; RSpec для серверной правки F7 не требуется. Новых зависимостей нет, `enterprise/` не меняется.

## F9: опознание пользователя при загрузке виджета

| Файл | Место и назначение правки | Контракт / поведение | Риск при обновлении upstream | Проверка |
| --- | --- | --- | --- | --- |
| `app/javascript/entrypoints/{sdk.js,widget.js}`, `app/javascript/sdk/IFrameHelper.js`, `app/javascript/widget/helpers/bootstrap.js` | EVIRMA: получить подписанный контакт до монтирования виджета и подключения ActionCable. | `window.chatwootSettings.user = { identifier, identifier_hash, name, email }` задаётся до `chatwootSDK.run`. В URL рамки добавляется только `bootstrap=true`. Рамка запрашивает данные у родителя; SDK проверяет её source/origin и отвечает на origin виджета. Рамка принимает ответ только от своего родителя и отправляет `user` телом POST `/api/v1/widget/config`, имеющийся `conversationToken` — штатным заголовком `X-Auth-Token`. Подключение WebSocket использует итоговый pubsub-токен; событие `chatwoot:conversation-token` с `{ token }` приходит через обычный `loaded`. Отдельный `setUser` после ready не нужен; повторный вызов с тем же identifier сохраняет контакт. `reset()` очищает начального пользователя. Без `user` остаётся прежний запуск. | Средний: сохранить порядок bootstrap → монтирование → loaded/подписка, проверки source/origin и отсутствие подписи в URL. | SDK-спеки и новые `entrypoints/widget.spec.js`, `widget/helpers/specs/bootstrap.spec.js`: передача данных, cookies, итоговый токен, отсутствие повторного setUser, недоверенные сообщения, ожидание POST до mount/подписки. |
| `app/controllers/widgets_controller.rb`, `app/views/widgets/show.html.erb`, `app/controllers/api/v1/widget/{configs,contacts}_controller.rb`, `app/helpers/widget_helper.rb`, `app/services/widget/bootstrap_contact_service.rb`, `app/views/api/v1/widget/configs/create.json.jbuilder` | EVIRMA: проверка HMAC до создания контакта и изоляция токена по каналу. | GET `/widget?bootstrap=true` не создаёт контакт. POST использует ту же HMAC-SHA256 и constant-time проверку, что `set_user`. Верная подпись находит/создаёт контакт с identifier в аккаунте и проверенную связь текущего канала; анонимного промежуточного контакта нет. Гость с токеном сливается в контакт пользователя штатным `ContactMergeAction`; его связь становится проверенной, поэтому гостевая беседа остаётся видимой. Токен другого identifier или inbox игнорируется. Неверная подпись возвращает гостевой bootstrap и штатную ошибку `SET_USER_ERROR` через SDK. При обязательном HMAC отсутствие подписи отклоняется; при необязательном сохраняется штатное неподписанное опознание без выдачи чужой проверенной сессии. | Средний: при изменении ContactMergeAction и отбора проверенных связей сохранить гостевую беседу и границы аккаунта/канала. Подпись постоянная, как у штатного setUser. | Request-спеки config и GET /widget: новый/существующий пользователь, подпись, слияние и видимость беседы, чужой identifier/inbox/account, повторный setUser, необязательный HMAC. |
| `config/initializers/filter_parameter_logging.rb` | EVIRMA: скрыть постоянную подпись из журналов параметров. | `identifier_hash` фильтруется и во вложенном объекте `user`; для применения изменения нужен обычный перезапуск Rails. | Низкий. | Проверить фильтрацию параметров запроса после перезапуска сервера. |
| `app/javascript/widget/views/specs/Home.spec.js` | EVIRMA: исправить неполную фикстуру истории и проверку заглушки. | Сервер `Widget::ContactHistory#payload` всегда выдаёт строковый `message_type`; фикстура теперь соответствует этому контракту. Текст сообщения проверяется через prop заглушки ChatMessage. Производственный компонент не меняется. | Низкий. | Все 9 тестов Home.spec. |

Проверки F9 и всех существующих путей SDK/виджета:

```sh
TZ=UTC node_modules/.bin/vitest run --no-coverage app/javascript/entrypoints app/javascript/sdk app/javascript/widget
node_modules/.bin/eslint app/javascript/entrypoints/sdk.js app/javascript/entrypoints/sdk.spec.js app/javascript/entrypoints/widget.js app/javascript/entrypoints/widget.spec.js app/javascript/sdk/IFrameHelper.js app/javascript/sdk/specs/IFrameHelper.spec.js app/javascript/widget/helpers/bootstrap.js app/javascript/widget/helpers/specs/bootstrap.spec.js app/javascript/widget/views/specs/Home.spec.js
eval "$(rbenv init -)"
bundle exec rspec spec/controllers/widgets_controller_spec.rb spec/controllers/api/v1/widget/configs_controller_spec.rb spec/controllers/api/v1/widget/contacts_controller_spec.rb
bundle exec rubocop app/controllers/widgets_controller.rb app/controllers/api/v1/widget/configs_controller.rb app/controllers/api/v1/widget/contacts_controller.rb app/helpers/widget_helper.rb app/services/widget/bootstrap_contact_service.rb config/initializers/filter_parameter_logging.rb app/views/api/v1/widget/configs/create.json.jbuilder spec/controllers/widgets_controller_spec.rb spec/controllers/api/v1/widget/configs_controller_spec.rb
```

Новых зависимостей и изменений схемы данных нет, `enterprise/` не меняется.

## F9: устранение гонок гостевого bootstrap после ревью

| Файл | Место и назначение правки | Контракт / поведение | Риск при обновлении upstream | Проверка |
| --- | --- | --- | --- | --- |
| `app/services/widget/bootstrap_contact_service.rb` | EVIRMA: блокировка и повторное чтение гостя до поиска пользователя и слияния. | Два подписанных bootstrap одного гостя сериализуются в транзакции. Слияние разрешено только при пустом либо совпадающем подписанном identifier после блокировки. Уже удалённый/слитый гость не вызывает ошибку: выдаётся проверенная связь пользователя. `hmac_verified` устанавливается только на свежепрочитанной связи итогового пользователя; исходная каноническая связь сохраняет приоритет. Неподписанный вход с ранее проверенным гостевым токеном получает новую непроверенную сессию без доступа к проверенной истории пользователя. | Средний: сохранить блокировку до создания пользователя, повторную проверку identifier и принадлежность связи при изменениях слияния. | Спека сервиса: устаревший identifier, пометка связи после слияния, удалённый гость и его связь. Request-спеки: слияние другой вкладкой и отсутствие доступа к чужой истории без подписи. |
| `app/controllers/api/v1/widget/configs_controller.rb`, `spec/controllers/api/v1/widget/configs_controller_spec.rb` | EVIRMA: разделение проверки подписи и обработки ошибки без изменения API; исправление выравнивания hash. | Публичный контракт F9 сохранён. Неверная подпись, включая 64 hex-символа, возвращает гостевой контакт и прежний `set_user_error`. | Низкий. | Дополнительный пример с неверным digest правильной длины; RuboCop без отключений cop. |

Пример `defers contact creation` в `spec/controllers/widgets_controller_spec.rb` проверяет отсутствие изменения количества контактов именно при `bootstrap=true`, успешный GET и флаг отложенной загрузки. Код GET и шаблон не менялись: известные падения с `ViteRuby::MissingExecutableError` относятся к отсутствующим собранным ассетам окружения.

Проверки исправлений:

```sh
ruby -c app/services/widget/bootstrap_contact_service.rb
ruby -c app/controllers/api/v1/widget/configs_controller.rb
ruby -c spec/services/widget/bootstrap_contact_service_spec.rb
ruby -c spec/controllers/api/v1/widget/configs_controller_spec.rb
eval "$(rbenv init -)"
bundle exec rspec spec/services/widget/bootstrap_contact_service_spec.rb spec/controllers/api/v1/widget/configs_controller_spec.rb spec/controllers/widgets_controller_spec.rb
bundle exec rubocop app/services/widget/bootstrap_contact_service.rb app/controllers/api/v1/widget/configs_controller.rb spec/services/widget/bootstrap_contact_service_spec.rb spec/controllers/api/v1/widget/configs_controller_spec.rb
```

Локально `ruby -c` доступен; RSpec и RuboCop требуют проектный Ruby 3.4.4 (на машине Ruby 2.6.10, `rbenv` отсутствует). RSpec с собранными Vite-ассетами запускает координатор в контейнере. JavaScript не менялся, Vitest/eslint не требуются. Новых зависимостей и изменений `enterprise/` нет.

F9 review follow-up: bootstrap retries the full transaction once for deadlocks and identifier uniqueness races; HTTP/live cross-channel history requires a verified contact inbox and an identifier; setUser verifies the session only after successful identification.
RSpec regressions cover retry success/exhaustion, unrelated validation errors, unverified history recipients and failed identification (422); RSpec is run by the coordinator.

## Шапка виджета: компактные мессенджеры и своя подпись

EVIRMA: `MessengerButtons.vue` показывает Telegram и MAX в одну строку, с локальными
SVG слева и короткими названиями. Полный перевод действия остаётся в `title` и
`aria-label`; событие `chatwoot:messenger-requested` с `{ channel }` сохранено.
Telegram использует `#229ED9`, знак MAX из https://go.max.ru/brandbook — цвет текста
виджета, включая тёмную тему. Внешних загрузок и новых зависимостей нет.

Необязательная строка `window.chatwootSettings.headerSubtitle` задаётся до запуска
SDK. `entrypoints/sdk.js` сохраняет её в `$chatwoot`, `sdk/IFrameHelper.js` передаёт
через `config-set`, `widget/store/modules/appConfig.js` хранит её с пустым значением
по умолчанию. `ChatHeader.vue` показывает подпись вместо времени ответа только
в сети, максимум в две строки. Вне рабочего времени остаётся F6; без настройки —
штатный статус. Большая шапка и отдельная карточка доступности сохраняют свои тексты.
Контейнер текста компактной шапки сжимается, аватар и кнопки действий — нет.

Проверки: `components/specs/EvirmaHeader.spec.js` — короткие подписи, SVG, доступные
названия, прежние события, приоритет F6, текст без настройки и смена статуса;
`entrypoints/sdk.spec.js`, `sdk/specs/IFrameHelper.spec.js`, `widget/specs/App.spec.js` —
доставка настройки от хоста. Общий прогон:
`TZ=UTC node_modules/.bin/vitest run --no-coverage app/javascript/entrypoints app/javascript/sdk app/javascript/widget`;
ESLint — по изменённым JS/Vue-файлам. При слиянии upstream повторить проверки шапки
на ширине 360–400 px в светлой и тёмной теме.

Исходники SDK изменены: для доставки `headerSubtitle` нужна пересборка
`pnpm build:sdk` и публикация нового `public/packs/js/sdk.js` вместе с виджетом.
`enterprise/` и git не менялись.

Локальный результат: 55 файлов / 439 тестов Vitest прошли, ESLint изменённых
JS/Vue-файлов — без замечаний. Временный браузерный стенд с настоящими компонентами
и стилями проверен при ширине контейнера 360 и 400 px в обеих темах, с аватаром
и тремя кнопками действий: мессенджеры в одну строку без пересечений, подпись
не выше двух строк, включая длинный текст без пробелов; F6 вне сети сохранён.
HTTP-сервер запрещён песочницей (`listen EPERM`), поэтому стенд собран отдельно
во временную папку и открыт как локальный файл. Проверка живого расширения на WB
и публикация собранного SDK не выполнялись.

## Ротация гостевых учётных данных при подписанном входе

EVIRMA: подписанный `setUser` и подписанный bootstrap отзывают оба гостевых
ключа: `source_id` для JWT и `pubsub_token` для ActionCable. Связь
`contact_inbox` и гостевые беседы сохраняются. Запросы со старым JWT получают
404, а старый pubsub-токен больше не находит связь для событий. Итоговый JWT
и pubsub-токен выдаются только после повторной проверки, что связь принадлежит
контакту с подписанным идентификатором.

`setUser` блокирует исходную связь и контакт, повторно сверяет её `source_id` и выполняет
идентификацию, проверку владельца и ротацию в одной транзакции. Ошибка проверки
владельца возвращает 401 и откатывает изменения. Bootstrap первым блокирует и
повторно читает связь, затем гостевой контакт; мигрированная связь меняет оба
ключа перед выдачей итоговой конфигурации. Каноническая проверенная связь
опознанного контакта сохраняет приоритет. Повторный подписанный вход в уже
проверенную связь того же идентификатора сохраняет ключи; даже ранее
помеченная проверенной анонимная связь ротируется. Неподписанный путь остаётся
без изменений.

Ответ `setUser` возвращает оба новых ключа. Виджет ставит JWT в
`window.authToken`, заголовок HTTP и cookie через существующее событие SDK,
затем обновляет подписку ActionCable на прежнем consumer до загрузки истории.
Обновление сохраняет обработчики событий и таймер присутствия. Bootstrap уже
ставит оба ключа до монтирования виджета. Новых зависимостей и изменений схемы
данных нет.
EVIRMA: обновления беседы не передают `pubsub_token`; неподписанный bootstrap отбрасывает связь после ротации, а подписанный вход и bootstrap блокируют контакт перед связью.
