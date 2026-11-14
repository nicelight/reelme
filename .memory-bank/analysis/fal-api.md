---
type: research
status: active
checked: 2026-11-14
---
# fal.ai — API для ReelMe

Проверены официальные API-страницы и публичные OpenAPI-схемы. Генерации не запускались;
доступ аккаунта, фактическое качество, время и стоимость полного сценария не проверены.
Требования продукта — в [brief.md](brief.md). Таблица описывает API, а не заменяет требования.
Выбранная интеграция и параметры хранения — [контракт](../contracts/integrations.md#генерация-fal).

## Модели

| Режим / модель | Endpoint и официальная схема | Существенные ограничения |
|---|---|---|
| V2V MiniMax H3 Max Recast | [`minimax/h3-max/recast`](https://fal.ai/models/minimax/h3-max/recast/api) | Обязательны `video_url`, `reference_image_urls`; 1–4 фото соответствуют разным людям. Для ReelMe одно фото, без `prompt` (API допускает его отсутствие). Видео 5–30 с, непрерывный shot ≤15 с; `768P`/`1080P`. |
| V2V Kling O1 Edit Pro | [`fal-ai/kling-video/o1/video-to-video/edit`](https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/edit/api) | `prompt`, `video_url`; персонаж через `elements`, общие фото через `image_urls`, суммарно до 4 элементов и общих изображений. Вход 3–10 с, MP4/MOV ≤200 MB. Поля выходного разрешения нет; `keep_audio` по умолчанию false. |
| V2V Kling O3 Edit Pro | [`fal-ai/kling-video/o3/pro/video-to-video/edit`](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit/api) | `prompt`, `video_url`; `elements` и `image_urls`, общий предел 4. Вход 3–15 с, MP4/MOV ≤200 MB. Поля выходного разрешения нет; `keep_audio` по умолчанию true. |
| V2V Kling 4 Editing | [`kling/v4/video-to-video/edit`](https://fal.ai/models/kling/v4/video-to-video/edit/api) | `prompt`, `video_url`; до 10 `image_urls`, до 7 `elements`. Видео 3–30 с, вход ≤300 MB; `720p`/`1080p`. |
| V2V Kling 4 Flash Editing | [`kling/v4/flash/video-to-video`](https://fal.ai/models/kling/v4/flash/video-to-video/api) | `prompt`, `video_url`; до 10 `image_urls`, до 7 `elements`. Видео 3–20 с, вход ≤300 MB; только `720p`. |
| P2V Kling 4 Reference | [`kling/v4/reference-to-video`](https://fal.ai/models/kling/v4/reference-to-video/api) | `prompt` либо `multi_prompt`; до 10 `image_urls`, до 7 `elements`. 3–30 с; `720p`/`1080p`. |
| P2V Kling O3 Reference Pro | [`fal-ai/kling-video/o3/pro/reference-to-video`](https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video/api) | `prompt` либо `multi_prompt`; `elements` и `image_urls`. Один персонаж + 3 общих фото укладываются в указанный предел 4; более широкий image-only лимит из описания неясен. 3–15 с, `duration` — строка. Поля разрешения нет. |
| P2V Kling 4 Flash Reference | [`kling/v4/flash/reference-to-video`](https://fal.ai/models/kling/v4/flash/reference-to-video/api) | `prompt`; до 10 `image_urls`, до 7 `elements`. 3–20 с; только `720p`. Оператор подтвердил этот endpoint вместо Editing в P2V. |
| P2V H3 Max Reference | [`minimax/h3-max/reference-to-video`](https://fal.ai/models/minimax/h3-max/reference-to-video/api) | Обязательны `prompt`, `prompt_expansion_mode`; последний допускает `disabled`. До 9 `reference_image_urls`, до 12 медиа суммарно. `duration` 0.92–15 с; `480P`/`768P`/`1080P`. |
| P2V Vidu Q4 Reference | [`fal-ai/vidu/q4/reference-to-video`](https://fal.ai/models/fal-ai/vidu/q4/reference-to-video/api) | `prompt`; до 12 `reference_image_urls` общим списком. 3–16 с; `540p`/`720p`/`1080p`/`2K`/`4K`. |
| P2V Gemini Omni Flash 1.2 | [`google/gemini-omni-flash/v1.2/reference-to-video`](https://fal.ai/models/google/gemini-omni-flash/v1.2/reference-to-video/api) | `prompt`; до 10 `image_urls`. 3–15 с; `360p`/`720p`/`1080p`/`4k`. |

Машинные схемы доступны через
`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint>`.
Десятисекундный сценарий укладывается в длительности всех выбранных моделей;
768p не является общим для них разрешением. Значения и регистр параметров различаются.

## Передача фото и промптов

- Для Kling четыре фото посетителя представляются одним `elements[0]`:
  `frontal_image_url` + три `reference_image_urls`; до трёх фото слота — в `image_urls`.
  Это один персонаж, а не четыре независимых элемента. У O1/O3 дополнительные ракурсы — 1–3.
- Для H3 Reference, Vidu и Gemini — упорядоченный список: четыре фото посетителя,
  затем до трёх фото слота. Семь файлов укладываются в проверенные лимиты.
- Ссылки в промпте зависят от модели: Kling `@Element1`/`@Image1`, H3 `Image 1`,
  Vidu `[@reference_image_1]`, Gemini `<IMAGE_REF_0>`. Нужны подсказки выбранной модели в админке.
- Для Recast без промпта следует выбирать шаблон с однозначным главным персонажем:
  API по умолчанию сопоставляет референсы основным людям слева направо.
- Выход — `video.url`, дополнительные метаданные файла могут отсутствовать.
  Пример MIME в документации не заменяет проверку реально скачанного видео.

## Файлы и хранение

fal поддерживает загрузку файла один раз с повторным использованием URL. Принимаются
также URL нашего сервера, доступные без cookies и дополнительных заголовков, включая
presigned URL. Это устраняет повторную загрузку байтов нашим приложением, но не гарантирует
отсутствия повторного скачивания внутри fal. Рекомендуется хранить URL материалов в слоте
и менять их при замене файла. Демо P2V в запрос не включается.
[Официальная документация CDN](https://fal.ai/docs/documentation/model-apis/fal-cdn).

Без настройки срока хранения файлы CDN могут оставаться бессрочно доступными по URL.
`X-Fal-Object-Lifecycle-Preference` задаёт срок; `X-Fal-Store-IO: 0` отключает хранение
JSON input/output, а не удаляет медиа. Удаление мероприятия у нас не удаляет копии fal.
[Заголовки](https://fal.ai/docs/documentation/model-apis/common-parameters).

Input-файлы не удаляются при удалении payload запроса, поскольку могут использоваться повторно.
Отдельное удаление CDN-файла: `POST https://rest.fal.ai/storage/files/delete`, `file_url`,
разрешение `assets:write`. Общие материалы слотов нельзя удалять вместе с одним мероприятием.
[Хранение](https://fal.ai/docs/documentation/model-apis/media-expiration),
[удаление файлов](https://fal.ai/docs/documentation/model-apis/fal-cdn#deleting-files).

## Очередь, прогресс и повторы

- Submit возвращает `request_id`, `status_url`, `response_url`, `cancel_url` — их нужно
  сохранять. Статусы: `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`. Последний включает ошибки
  и отмену; сам по себе не означает готовое видео. Универсального процента прогресса нет,
  доступны этап и позиция очереди; логи обычному вызывающему могут быть недоступны.
  [Очередь](https://fal.ai/docs/documentation/model-apis/inference/queue),
  [схема статуса](https://fal.ai/docs/api-reference/inference-api/queue/status).
- При известном ID продолжаем проверять тот же запрос; status/result не расходуют попытку
  генерации. `client_timeout` не останавливает работу сервера. При потере ответа submit
  результат запуска неоднозначен: документированный idempotency key в проверенных схемах
  не найден, повтор может создать вторую генерацию. По принятому требованию приложения
  повторная отправка допускается именно при отсутствии подтверждения принятия задания;
  после получения `request_id` повторный submit запрещён. Явный отказ валидации или
  терминальная ошибка модели не являются потерянным подтверждением.
  Оператор принял возможный дубль при потере подтверждения: отдельная защита от него
  не требуется в рамках KISS.
  [Надёжность](https://fal.ai/docs/documentation/model-apis/inference/reliability),
  [submit](https://fal.ai/docs/api-reference/inference-api/queue/submit-path).
- Принятый путь: подтверждённый запрос генерации с включёнными по умолчанию повторами fal,
  без собственного цикла пяти запусков после ошибок модели; повтор submit допускается
  только до получения подтверждения. Для очереди действует потолок 10 попыток суммарно.
  Стандартные retry-условия — 503/504 и инфраструктурные обрывы; обычные 500/502
  автоматически не повторяются, если приложение модели не меняет поведение через
  `X-Fal-Needs-Retry`. Ожидание свободной мощности в очереди не расходует попытку.
  [Подробное описание retries](https://fal.ai/docs/documentation/serverless/reliability/retries).
- Ошибки валидации, неподходящих файлов и content policy обычно неповторяемы (422).
  Ошибка внешнего провайдера обрабатывается согласно тому, как endpoint fal представляет
  её платформе; обещания повторить любую ошибку нет.
  [Ошибки моделей](https://fal.ai/docs/documentation/model-apis/errors).
- `X-Fal-No-Retry` не устанавливаем; `X-Fal-Retry-Config` не применяется к публичным
  моделям. Отдельный `x-app-fal-disable-fallback: true` позволяет отключить замену
  endpoint, сохранив retries; в контракте ReelMe этот заголовок используется.
  [Заголовки](https://fal.ai/docs/documentation/model-apis/common-parameters).
- Во время retry запрос может вернуться в очередь; публичный API не гарантирует
  отдельного `RETRYING` или счётчика попыток. При терминальной ошибке прекращаем ожидание,
  сохраняем и показываем ошибку. `start_timeout` ограничивает ожидание старта, но не
  уже выполняющуюся генерацию.
  [Очередь](https://fal.ai/docs/documentation/model-apis/inference/queue),
  [timeouts](https://fal.ai/docs/documentation/serverless/reliability/retries#timeouts-and-retries).
- Транспортные retries SDK отличаются от повторов вычисления fal. Проверенный JS SDK
  `queue.submit()` на ветке `main` использует `maxRetries: 3`; один вызов SDK может
  отправить несколько HTTP POST. Это совместимо с принятым допущением о возможных
  дублях при потере подтверждения; exactly-once гарантия не требуется.
  [queue.ts](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/queue.ts),
  [request.ts](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/request.ts).
- Webhooks доступны, требуют проверки подписи и допускают повторные доставки.
  Для первой версии достаточно серверного polling по сохранённым ID; отдельный процесс
  на каждую сессию не нужен. Это рекомендация; принятый стек — в [архитектуре](../architecture/system-architecture.md).
  [Webhooks](https://fal.ai/docs/documentation/model-apis/inference/webhooks).
- Результат нужно забрать своевременно: очередь хранит result JSON ограниченное время
  (обычно час, для ответа ≥10 KB — шесть минут); это не срок жизни CDN-видео.
  [Result API](https://fal.ai/docs/api-reference/inference-api/queue/result).

## Рекомендуемый минимальный путь

`reelme.html` отправляет фото и выбранный слот нашему backend. Он сохраняет сессию,
передаёт URL в fal и отслеживает запрос. После успеха скачивает и проверяет видео,
сохраняет у нас и публикует собственную ссылку, email-форму и карточку. Ошибка скачивания
готового видео требует повторного скачивания, а не новой генерации. Состояние сессий
должно переживать перезапуск обработчика. Ключ fal хранится только на сервере.
[Серверная авторизация](https://fal.ai/docs/documentation/model-apis/inference/proxy-setup).
