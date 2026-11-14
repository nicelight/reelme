# TASK-007 — локальная проверка десяти fal-адаптеров

2026-11-14. Реализован `src/server/sessions/model-input.ts`; существующий worker
переиспользует submit/poll/result/download/FFmpeg без отдельного движка.
Все настройки берутся из сохранённого снимка. Общая валидация промпта ограничивает
O1/O3 до 2500 и Vidu до 5000 символов по официальным схемам; остальные прежние
ограничения редактора сохранены. Состав моделей и канонические спецификации не менялись.

## Сверка API и локальный проход

Официальные схемы получены 2026-11-14 из
`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint>`:
[снимок схем и source URLs](official-schemas.json).
`validate-schemas.py` использует jsonschema 4.26.0: проверяет фактические payload,
обязательные поля, типы, enum, диапазоны, вложенные `$ref`; отдельно отвергает
поля, которых нет в схеме выбранного input. Условия из текстовых описаний
(один персонаж, порядок, синтаксис ссылок) проверены тестом и сравнены вручную.

Для каждой строки ниже schema validation и технический локальный проход — PASS.
У Kling везде один `elements[0]`: frontal + три reference. У остальных P2V —
четыре фото одного посетителя, затем до трёх фото слота. Промпт передаётся без
переписывания; штатные подсказки используют модельный синтаксис ссылок.

| Endpoint / официальная API-страница | Фактический payload в проходе |
|---|---|
| [O1 Edit](https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/edit/api) | video_url, prompt, elements, image_urls=[]; без resolution/duration |
| [O3 Edit Pro](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit/api) | video_url, prompt, elements, image_urls=[]; без resolution/duration |
| [Kling 4 Editing](https://fal.ai/models/kling/v4/video-to-video/edit/api) | video_url, prompt, elements, image_urls=[]; 1080p; без duration |
| [Kling 4 Flash Editing](https://fal.ai/models/kling/v4/flash/video-to-video/api) | video_url, prompt, elements, image_urls=[]; 720p; без duration |
| [Kling 4 Reference](https://fal.ai/models/kling/v4/reference-to-video/api) | prompt, elements, три image_urls; duration=10 (number), 1080p |
| [O3 Reference Pro](https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video/api) | prompt, elements, три image_urls; duration="10" (string); без resolution |
| [Kling 4 Flash Reference](https://fal.ai/models/kling/v4/flash/reference-to-video/api) | Reference endpoint; prompt, elements, три image_urls; duration=10, 720p |
| [H3 Max Reference](https://fal.ai/models/minimax/h3-max/reference-to-video/api) | prompt с Image 1–5, семь reference_image_urls; duration=0.92, 1080P, prompt_expansion_mode=disabled |
| [Vidu Q4 Reference](https://fal.ai/models/fal-ai/vidu/q4/reference-to-video/api) | prompt с [@reference_image_1]–[@reference_image_5], семь reference_image_urls; duration=10, 4K |
| [Gemini Omni Flash 1.2](https://fal.ai/models/google/gemini-omni-flash/v1.2/reference-to-video/api) | prompt с <IMAGE_REF_0>–<IMAGE_REF_4>, семь image_urls; duration=10, 4k |

[Наблюдения](model-observations.json) содержат 12 session ID, фактические payload,
подтверждённые request ID, метаданные файлов и HTTP-вызовы SDK.
Два дополнительных прохода доказывают неизменность старого снимка и смену
настроек только для новой сессии. До submit слот Kling изменён на Gemini с другим
prompt, duration, resolution и набором referenceIds; старые сессии всё равно
отправлены в Kling с прежними настройками. Две старые P2V-сессии получили
одинаковые URL общих материалов и разные URL собственных фото.

Фото загружались в порядке 3,1,0,2; payload содержит 0,1,2,3. Для каждого URL
сопоставлены session/pose или slot_media_id и проверены выдаваемые байты без
Authorization. P2V-демо не входит ни в одно видео-поле. SDK делает только
submit/status/result на queue.fal.run: 12 POST submit, никаких CDN uploads.

Каждый из 12 результатов прошёл полный FFmpeg decode, ffprobe (1280×720, 3 с),
извлечение JPEG и проверку собственных `sessions/<sessionId>/result.mp4`.
Тестовый ролик синтетический и одинаковый: это проверка pipeline и принадлежности
результата, не генерации моделью или соблюдения заказанной длительности/качества.
После сохранения остаётся `preparing`; ready/выдача принадлежат TASK-008.

## Выполненные команды

- `REELME_MODEL_ARTIFACTS=.tasks/TASK-007-T2-FT-003-W5 npx tsx --test tests/model-generation.test.ts`: 2/2 PASS ([первый проход](model-tests.log)).
- `REELME_MODEL_ARTIFACTS=.tasks/TASK-007-T2-FT-003-W5 npm test`: 36/36 PASS, 0 skipped/cancelled ([лог](tests.log)); включает неизменные Recast regression tests TASK-006.
- `npm run check`: 0 errors, 0 warnings ([лог](check.log)).
- `npm run build`: PASS ([лог](build.log)).
- `uv run --with jsonschema==4.26.0 .tasks/TASK-007-T2-FT-003-W5/validate-schemas.py`: 12 payload / 10 endpoint PASS ([лог](schema-validation.log), [результаты](schema-validation.json)).
- `git diff --check`: PASS.

Для воспроизведения schema validation сначала выполнить тест с указанным
REELME_MODEL_ARTIFACTS, затем Python-команду. Python-пакет только для этой проверки;
production dependencies не изменены.

## Ограничения

Реальные вызовы fal отменены оператором на этапе разработки и не выполнялись.
Доступ аккаунта, платная генерация, художественное качество и живая совместимость
не подтверждены. HTTPS URL и handler выдачи проверены через Fastify injection;
публичная TLS-доступность VPS здесь не проверялась. Browser regression не запускался:
UI не менялся; общая валидация и серверные API покрыты локальными тестами.
`x-fal` ограничения свойств удалённых медиа не исполняются JSON Schema validator:
тест использует JPEG 720×720 и видео 1280×720@24fps, но существующий редактор/приём
фото не проверяет всю модельную матрицу min dimensions/FPS. Это ограничение
сообщено оркестратору; отдельная файловая валидация здесь не расширялась.
