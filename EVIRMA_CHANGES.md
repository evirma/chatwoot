# Правки EVIRMA поверх Chatwoot v4.18.0

CW1 добавляет постоянную панель EVIRMA над панелью контакта в правой колонке
разговора. Администратор аккаунта создаёт Dashboard App с точным названием
`evirma:right-panel` и содержимым
`[{"type":"frame","url":"https://..."}]`. Без такой записи панель не отображается.
Скрытие правой колонки сохраняет штатное поведение.

| Штатный файл | Строки / суть | Зачем | Риск конфликта | Проверка после слияния upstream |
| --- | --- | --- | --- | --- |
| `config/routes.rb`, `app/listeners/action_cable_listener.rb` | EVIRMA: маршрут `GET /api/v1/widget/contact_history` и вызов `Widget::ContactHistory` после штатного `message.created`. | Последние 100 публичных входящих/исходящих сообщений идентифицированного контакта из других каналов того же аккаунта; отдельное событие `contact.history_message.created` на веб-каналы этого контакта. | Низкий: два места подключения; проверять авторизацию виджета и штатный обработчик сообщений после обновления. | Запросить историю своим и чужим токеном, гостем; проверить исключение заметок, служебных сообщений и текущего канала. Ответить в MAX/Telegram/почте: сообщение появляется без перезагрузки только у своего контакта. |
| `app/javascript/widget/components/ConversationWrap.vue`, `app/javascript/widget/store/index.js`, `app/javascript/widget/store/modules/contacts.js` | EVIRMA: подключить отдельные компонент и хранилище истории; сбрасывать историю при `setUser` и загружать с обновлённым токеном. | Сворачиваемая история перед текущей беседой; ограничение 100 сообщений, защита от восстановления прежнего контакта запоздавшим запросом. | Низкий: новые импорты и вызовы, штатные сообщения хранятся отдельно. | Открыть беседу, свернуть и развернуть историю; открыть виджет повторно; сменить контакт через SDK во время загрузки истории. |
| `app/javascript/widget/helpers/actionCable.js`, `app/views/widgets/show.html.erb` | EVIRMA: передавать `inboxId`, исключать чужие каналы из штатных событий, обрабатывать отдельное событие истории и обновлять её после переподключения. | Избежать смешивания бесед и двойных уведомлений при штатной HMAC-рассылке. Исходящие сообщения истории вызывают `chatwoot:on-message` через штатный `IFrameHelper`. | Средний: при смене способа настройки виджета нужно сохранить `inboxId`. | С HMAC и без него, в том числе без текущей веб-беседы: один ответ из другого канала — одно событие родителю; ответ текущего канала идёт штатным путём. Восстановить соединение и проверить пропущенные сообщения. |
| `app/javascript/widget/i18n/locale/en.json` | EVIRMA: исходная строка `EVIRMA_CONTACT_HISTORY.TITLE`; JSON не допускает комментариев, поэтому метка вынесена сюда и в имя ключа. | Заголовок «История из других каналов», английский источник `History from other channels`. | Низкий. | Переводы остальных языков, включая русский, поступают через Crowdin по правилам проекта. |
| `app/javascript/dashboard/components/widgets/conversation/ConversationSidebar.vue` | Импорт `EvirmaPanel` рядом с другими импортами; компонент перед прокручиваемым `ContactPanel`. Обе правки помечены `EVIRMA:`. | Отображать приложение над контактом без изменения `activeTab` и скрытия колонки. | Низкий: три добавленные строки; проверить перенос или перестройку правой колонки. | Открыть два разговора по очереди: iframe сверху, контакт ниже прокручивается; кнопка скрытия колонки работает. Удалить приложение: панель исчезает, штатный интерфейс сохраняется. |
| `app/javascript/dashboard/components/widgets/conversation/ConversationBox.vue` | Получать исходный список как `allDashboardApps`; вычислять `dashboardApps`, исключая точное название `evirma:right-panel`. Правка помечена `EVIRMA:`. | Исключить приложение одновременно из вкладок, центральных фреймов и проверки наличия вкладок; сохранить их индексы. | Низкий: одна заменённая строка и пять добавленных; проверить изменения штатного списка Dashboard Apps. | Добавить обычные приложения до и после EVIRMA: вкладки открывают правильные страницы. Если есть только EVIRMA, центральные вкладки отсутствуют. Без EVIRMA обычные вкладки работают как прежде. |
| `app/controllers/api/v1/widget/conversations_controller.rb` | `set_custom_attributes`: объединять присланные атрибуты разговора с уже сохранёнными вместо замены. Правка помечена `EVIRMA:`. | Кабинет EVIRMA (`project_id`, `page`) и расширение (`wb_page_url`, `extension_version`) пишут в один разговор разные ключи и не должны стирать друг друга. Удаление ключа — штатный `destroy_custom_attributes`. | Низкий: одна строка. | `spec/controllers/api/v1/widget/conversations_controller_spec.rb`, случай `keeps previously set attributes`. |
| `app/models/channel/telegram.rb` | Единый адрес Bot API из `TELEGRAM_API_URL` для запросов и скачивания файлов; адрес `setWebhook` из `TELEGRAM_WEBHOOK_BASE_URL` с прежним `FRONTEND_URL` по умолчанию. Правки помечены `EVIRMA:`. | Сервер в РФ не достаёт Telegram напрямую; запросы и входящие вебхуки проходят через релей. | Низкий: настройки необязательны и сохраняют прежние адреса по умолчанию. | `spec/models/channel/telegram_spec.rb`: проверить запросы Bot API, адрес файла и адрес `setWebhook` с настройками и без них. |
| `app/javascript/entrypoints/sdk.js` | Читать булеву настройку `window.chatwootSettings.hideHeader`, по умолчанию `false`. Правка помечена `EVIRMA:`. | Позволить родительской странице скрывать шапку виджета. | Низкий: дополнительная настройка SDK. | Проверить запуск SDK с `hideHeader: true`, `false` и без настройки. |
| `app/javascript/sdk/IFrameHelper.js` | Передавать `hideHeader` в `config-set`; превращать `availability-changed` в событие окна `chatwoot:availability-changed` с `detail: { isOnline }`. Обе правки помечены `EVIRMA:`. | Передать настройку в рамку и дать внешней странице текущий статус операторов. | Низкий: поле настройки и отдельный обработчик события. | Проверить содержимое `config-set` и подписку внешней страницы на событие для обоих значений статуса. |
| `app/javascript/widget/store/modules/appConfig.js` | Хранить `hideHeader` со значением `false` по умолчанию; принимать его через штатные действие и изменение состояния. Правки помечены `EVIRMA:`. | Сохранить настройку скрытия шапки в общем хранилище виджета. | Низкий: одно дополнительное поле. | Передать `config-set` с `hideHeader: true`, затем без настройки: значение возвращается к `false`. |
| `app/javascript/widget/components/layouts/ViewWithHeader.vue` | Не создавать общий контейнер большой и компактной шапок при `appConfig.hideHeader`. Правка помечена `EVIRMA:`. | Скрыть обе шапки на главном экране и в разговоре. | Низкий: одно условие на существующем контейнере. | С `hideHeader: true` обе шапки отсутствуют; без настройки отображается прежняя шапка для текущего экрана. |
| `app/javascript/widget/App.vue` | Наблюдать штатный `useAvailability` с операторами из хранилища; после успешной загрузки отправить `{ event: 'availability-changed', isOnline }`, затем отправлять только при смене значения. Правки помечены `EVIRMA:`. | Сообщать статус независимо от экрана и видимости шапки, учитывая штатные рабочие часы. | Низкий: наблюдатель в существующем `setup`; сверить признаки загрузки операторов при обновлении upstream. | Проверить первое событие для пустого и непустого списка операторов, смену присутствия, отсутствие повторов и ожидание успешной загрузки после ошибки. |

Своя реализация находится в
`app/javascript/dashboard/components/widgets/conversation/EvirmaPanel.vue`,
проверки — в соседнем `specs/EvirmaPanel.spec.js`.
Штатный `DashboardApp/Frame.vue` используется без изменений: он передаёт
`appContext`, контакт, агента, определения атрибутов и тему.
Позиция `-1` отличает iframe от штатных вкладок. При смене разговора Frame
пересоздаётся. Видимость включается после обновления Vue, чтобы сработал
штатный наблюдатель `isVisible`, в том числе при поздней загрузке приложения.
Высота панели — `28rem`; на коротких экранах следует проверить оставшееся место
для панели контакта. Внешняя страница должна разрешать встраивание в iframe.

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
`bundle exec rspec spec/controllers/api/v1/widget/contact_history_controller_spec.rb spec/listeners/evirma_contact_history_spec.rb spec/listeners/action_cable_listener_spec.rb`.
Вручную проверить ответ из каждого канала, открытие вложений, повторное открытие
виджета, переподключение, переключение пользователя через SDK и подписку расширения
на `chatwoot:on-message`. Без `identifier` блока быть не должно.
