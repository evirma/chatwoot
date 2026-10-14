# Правки EVIRMA поверх Chatwoot v4.18.0

CW1 добавляет постоянную панель EVIRMA над панелью контакта в правой колонке
разговора. Администратор аккаунта создаёт Dashboard App с точным названием
`evirma:right-panel` и содержимым
`[{"type":"frame","url":"https://..."}]`. Без такой записи панель не отображается.
Скрытие правой колонки сохраняет штатное поведение.

| Штатный файл | Строки / суть | Зачем | Риск конфликта | Проверка после слияния upstream |
| --- | --- | --- | --- | --- |
| `app/javascript/dashboard/components/widgets/conversation/ConversationSidebar.vue` | Импорт `EvirmaPanel` рядом с другими импортами; компонент перед прокручиваемым `ContactPanel`. Обе правки помечены `EVIRMA:`. | Отображать приложение над контактом без изменения `activeTab` и скрытия колонки. | Низкий: три добавленные строки; проверить перенос или перестройку правой колонки. | Открыть два разговора по очереди: iframe сверху, контакт ниже прокручивается; кнопка скрытия колонки работает. Удалить приложение: панель исчезает, штатный интерфейс сохраняется. |
| `app/javascript/dashboard/components/widgets/conversation/ConversationBox.vue` | Получать исходный список как `allDashboardApps`; вычислять `dashboardApps`, исключая точное название `evirma:right-panel`. Правка помечена `EVIRMA:`. | Исключить приложение одновременно из вкладок, центральных фреймов и проверки наличия вкладок; сохранить их индексы. | Низкий: одна заменённая строка и пять добавленных; проверить изменения штатного списка Dashboard Apps. | Добавить обычные приложения до и после EVIRMA: вкладки открывают правильные страницы. Если есть только EVIRMA, центральные вкладки отсутствуют. Без EVIRMA обычные вкладки работают как прежде. |
| `app/controllers/api/v1/widget/conversations_controller.rb` | `set_custom_attributes`: объединять присланные атрибуты разговора с уже сохранёнными вместо замены. Правка помечена `EVIRMA:`. | Кабинет EVIRMA (`project_id`, `page`) и расширение (`wb_page_url`, `extension_version`) пишут в один разговор разные ключи и не должны стирать друг друга. Удаление ключа — штатный `destroy_custom_attributes`. | Низкий: одна строка. | `spec/controllers/api/v1/widget/conversations_controller_spec.rb`, случай `keeps previously set attributes`. |
| `app/models/channel/telegram.rb` | Единый адрес Bot API из `TELEGRAM_API_URL` для запросов и скачивания файлов; адрес `setWebhook` из `TELEGRAM_WEBHOOK_BASE_URL` с прежним `FRONTEND_URL` по умолчанию. Правки помечены `EVIRMA:`. | Сервер в РФ не достаёт Telegram напрямую; запросы и входящие вебхуки проходят через релей. | Низкий: настройки необязательны и сохраняют прежние адреса по умолчанию. | `spec/models/channel/telegram_spec.rb`: проверить запросы Bot API, адрес файла и адрес `setWebhook` с настройками и без них. |
| `app/javascript/entrypoints/sdk.js` | Читать булеву настройку `window.chatwootSettings.hideHeader`, по умолчанию `false`. Правка помечена `EVIRMA:`. | Позволить родительской странице скрывать шапку виджета. | Низкий: дополнительная настройка SDK. | Проверить запуск SDK с `hideHeader: true`, `false` и без настройки. |
| `app/javascript/sdk/IFrameHelper.js` | Передавать `hideHeader` в `config-set`; превращать `availability-changed` в событие окна `chatwoot:availability-changed` с `detail: { isOnline }`. Обе правки помечены `EVIRMA:`. | Передать настройку в рамку и дать внешней странице текущий статус операторов. | Низкий: поле настройки и отдельный обработчик события. | Проверить содержимое `config-set` и подписку внешней страницы на событие для обоих значений статуса. |
| `app/javascript/widget/store/modules/appConfig.js` | Хранить `hideHeader` со значением `false` по умолчанию; принимать его через штатные действие и изменение состояния. Правки помечены `EVIRMA:`. | Сохранить настройку скрытия шапки в общем хранилище виджета. | Низкий: одно дополнительное поле. | Передать `config-set` с `hideHeader: true`, затем без настройки: значение возвращается к `false`. |
| `app/javascript/widget/components/layouts/ViewWithHeader.vue` | Не создавать общий контейнер большой и компактной шапок при `appConfig.hideHeader`. Правка помечена `EVIRMA:`. | Скрыть обе шапки на главном экране и в разговоре. | Низкий: одно условие на существующем контейнере. | С `hideHeader: true` обе шапки отсутствуют; без настройки отображается прежняя шапка для текущего экрана. |
| `app/javascript/widget/App.vue` | Наблюдать штатный `useAvailability` с операторами из хранилища; после успешной загрузки отправить `{ event: 'availability-changed', isOnline }`, затем отправлять только при смене значения. Правки помечены `EVIRMA:`. | Сообщать статус независимо от экрана и видимости шапки, учитывая штатные рабочие часы. | Низкий: наблюдатель в существующем `setup`; сверить признаки загрузки операторов при обновлении upstream. | Проверить первое событие для пустого и непустого списка операторов, смену присутствия, отсутствие повторов и ожидание успешной загрузки после ошибки. |
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
