# Независимая проверка TASK-006

2026-11-14 · **VERDICT: PASS** в согласованном локальном объёме разработки.
Существенных нарушений не обнаружено. Lifecycle оставлен оркестратору.

Проверены карточка, FT-003-AC-001 (Recast), AC-002 (V2V), AC-003 и файловая часть
AC-004, contracts/integrations, HTTP/access, core-domain, lifecycle, boundary map,
реализация и тесты. Граница TASK-008 сохранена: готовый файл остаётся `preparing`,
без преждевременного `ready`. Материалы и результаты принадлежат соответствующим
модулям; короткие SQL-транзакции не охватывают сетевые вызовы или запись файлов.

## Независимые проверки

| Проверка | Результат |
|---|---|
| `npx tsx --test tests/generation.test.ts` | 7/7 PASS, без skipped/cancelled; [лог](verify-tests.log), [наблюдения](verify-independent/generation-observations.json) |
| `npm test` | 34/34 PASS, включая прежние capture/access/scenario API-проверки; [лог](verify-regression.log) |
| `npm run check` | 0 errors/warnings; [лог](verify-check.log) |
| `git diff --check` | PASS |

Полный build повторно не запускался: просмотрен успешный [лог исполнителя](local-build.log)
для замороженных входов, независимый typecheck выполнен. [Хеши входов](verify-inputs.json)
фиксируют рассмотренные source/tests/package files.

## Подтверждённые свойства

- A использует прежний файл/768P после правки слота, B/C — новый файл/1080P с одинаковым
  provider URL. Recast получает один JPEG и video URL без prompt. Capability открывает
  конкретный файл без аккаунта; неверный token даёт 404, административные маршруты
  не становятся доступными. Проверены фактические байты старого/нового материала.
- Подтверждённые ID и URLs записываются вместе с `observing` до polling. После рестарта
  продолжается тот же ID; после подготовки повторного submit/download нет. Три сессии
  дали три submit и три download. Потерянное подтверждение допускает второй submit,
  явный 422 и терминальные результаты его не допускают.
- Временный polling повторяет polling. Сбой download и restart `preparing` используют
  сохранённый URL: один submit, один result и два download. Пустой/повреждённый файл,
  COMPLETED с ошибкой и отказ result не становятся ready; фото сохраняются.
- Реальные ffprobe, полный FFmpeg decode и JPEG extraction проверены на синтетическом
  MP4 320×240, 5 секунд. Байты сохранены; после рестарта подготовленный результат
  остаётся `preparing`. Долгий submit не удерживает capture HTTP следующего посетителя.
- Ошибки capture-state содержат фиксированные безопасные сообщения. Независимый тест
  подтверждает удаление ключа и capability URL из server error details. SDK-тест
  проверяет headers, payload, обращение по подтверждённому ID и отсутствие CDN upload.

Поля Recast сверены с [официальной схемой](https://fal.ai/models/minimax/h3-max/recast/api),
а fallback/Store-IO/lifecycle headers — с [официальной документацией fal](https://fal.ai/docs/documentation/model-apis/common-parameters).
Поведение установленного `@fal-ai/client` 1.10.1 дополнительно прочитано в queue/response
реализации: возвращаемая ошибка содержит HTTP status, стандартные retries сохранены.

## Ограничения

Реальные fal-прогоны отменены оператором на этапе разработки; сеть/баланс/живой API
не проверялись и не объявляются PASS. Транспорт fal/download управляемый; SQLite,
HTTP-приложение, файлы и FFmpeg реальные. Эстетика не оценивается. UI не менялся,
поэтому browser regression повторно не запускался. Windows/Canon — TASK-005,
остальные адаптеры — TASK-007, ссылка/форма/ready — TASK-008.

Оснований для исправления исходников до закрытия TASK-006 не найдено. Можно оформить
`done` по действующим критериям, затем выполнить commit/push.
