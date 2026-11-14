# Независимая проверка TASK-004

2026-11-14 · **VERDICT: PASS** в согласованном объёме разработки. Существенных нарушений не обнаружено. Статус задачи оставлен `in_progress`; lifecycle принадлежит вызывающему агенту.

Проверены индекс задачи, зависимости TASK-002 (`done`) / TASK-003 (`done_for_prod`), FT-002-AC-002–004, относящиеся к задаче REQ-001/006/016/018, PRD, Constitution, HTTP/access/integration contracts, модель данных, lifecycle и boundary map. Прочитаны изменённые исходники, новый `PhotoSession.svelte`, API/browser tests, исходные отчёты и логи реализации. Контракты модулей соответствуют реализации и принятым границам: Sessions владеет файлами/метаданными, CaptureClient — повтором Blob и выдачей номера; обработчик fal не добавлен.

## Независимые запуски

| Проверка | Наблюдение |
|---|---|
| `npm test` | 27/27 PASS, 0 skipped; [лог](verify-independent-tests.log) |
| `npm run check` | PASS, 0 errors/warnings; [лог](verify-independent-check.log) |
| `npm run build` | PASS; [лог](verify-independent-build.log) |
| `REELME_BROWSER_ARTIFACTS=.tasks/TASK-004-T2-FT-002-W3/verify-independent-browser npm run test:ui -- tests/transfer.spec.ts` | Chromium, 1/1 PASS; [лог](verify-independent-browser.log), [наблюдения](verify-independent-browser/transfer-observations.json) |
| Стабильность входов и `git diff --check` | PASS; [фиксация SHA-256](verify-independent-inputs.json), [итог](verify-independent-integrity.log) |

HEAD `94fb3b69c074eb4f20d8902d969de1861d21c3b9` и проверенные source/tests/config не изменились за проверку. Browser запуск использовал свежую сборку. Исходные execution/browser evidence сохранены; независимый browser прогон покрывает transfer, прежний полный 4/4 browser regression просмотрен, но повторно целиком не запускался.

## Что подтверждено

- API/SQLite: полный набор 1/4, отказ неполного finalize (409), неверных JPEG/индексов (400), размера >20 MiB (413), неизвестной сессии (404); повтор позиции сохраняет остальные. Реальный decode предшествует публикации записи.
- Concurrent finalize даёт один переход `capturing → submit_pending` (audit trigger). PUT после finalize и начатая ранее потоковая замена дают 409; прежние запись и байты неизменны. Поток не удерживает SQL-транзакцию.
- Доступ к GET/PUT/finalize: без/с неверным bearer — 401, только admin/operator cookie — 403. Localhost CORS preflight — 204 с разрешённым PUT/Authorization; чужому origin доступ не объявляется. В браузере bearer, `credentials: omit`, без cookie, секрета в URL и внешних запросов.
- Независимый UI-проход: sessionId `0a1dd41f-e58e-4284-8d4f-defec47e0690` (001, Recast) и `0e3aa9f7-cd84-4cb9-a118-50b484f2fc4a` (002, четыре позы); пять разных путей и SHA-256 соответствуют пяти исходным JPEG. Следующий посетитель начат реальной кнопкой без reset/reload между посетителями; локальная старая сессия очищена, первая обработка ещё `submit_pending`.
- Контролируемый 503 загрузки позиции 1 повторяется тем же объектом Blob и байтами; сохранённая позиция 0 не изменяется. Всего пять затворов и пять скачиваний. Потерянный после commit ответ finalize восстанавливается GET без нового затвора/finalize; до подтверждения номер и следующий посетитель скрыты.
- Restart сохраняет оба набора и их статусы; отдельный API-прогон также сдвигает часы на 25 часов и подтверждает исходные дату, номер, план и байты.
- Визуально просмотрены независимые screenshots ожидания finalize, upload retry, номера 001 и мобильного 002: текст и действия читаемы, преждевременного номера нет, мобильный экран без горизонтального переполнения.

## Ограничения и следующий шаг

Настоящие Windows/Canon/digiCamControl, физический звук и production-домен не проверялись — принятый объём TASK-005. Камера использует управляемые HTTP-ответы и синтетические JPEG; backend, SQLite и файлы реальные во временном DATA_DIR. Обработчика генерации намеренно нет, `submit_pending` не выдаётся за успешную генерацию. fal/SMTP не вызывались. Невыгруженные Blob после перезагрузки вкладки не восстанавливаются — это явно принятое ограничение.

Можно оформить TASK-004 как `done_for_prod`, сохранив аппаратную/production-приёмку в TASK-005. Исправления исходников не требуются; дополнительных проверок до этого решения не предложено.
