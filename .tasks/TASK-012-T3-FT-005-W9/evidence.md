# TASK-012 — удаление мероприятий

Реализованы FT-005 AC-003 / REQ-015, REQ-018: admin подтверждает удаление прошедшего дня; один Sessions cleanup обслуживает DELETE, проверку при старте и ежечасный retention. Граница — строго больше 14 календарных дней Asia/Novosibirsk. `events.deleting` сохраняется до завершения, закрывает новые операции/выдачу и предотвращает публикацию позднего generation/email результата. Scenarios удаляет только материалы из удаляемых snapshots, не используемые текущими слотами или другими сессиями.

## Проверки

| Проверка | Фактический результат |
|---|---|
| `npm run check` | PASS, 0 errors / 0 warnings; [check.log](check.log) |
| `npm run build` | PASS; [build.log](build.log) |
| `npm test` | PASS, 66/66; [tests.log](tests.log) |
| cleanup + email после локального упрощения guard | PASS, 22/22; [final-targeted.log](final-targeted.log) |
| cleanup с дополнительным утверждением удаления late output до завершения cleanup | PASS, 4/4; [cleanup-functional.log](cleanup-functional.log) |
| Chromium cleanup + archive | PASS, 2/2; [browser.log](browser.log) |
| `git diff --check` | PASS |

Функциональные destructive fixtures создаются через `mkdtemp` в `/tmp/reelme-test-*`; точные каталоги записаны в cleanup-functional.log. Браузерный fixture — отдельный Node/tsx процесс на 127.0.0.1:3195, временная SQLite/media; точный каталог и файловые списки before/after — [observations](cleanup-browser-observations.json). Все эти каталоги удаляются после теста. Рабочая БД/медиа не использовались.

- API: anonymous 401, operator/installation 403, неверный Origin 403; admin сегодня/будущее 404. Успешный DELETE — 204; собственные photo/video/frame и DB rows удалены, старые receive/download/archive/photo-provider URLs — 404. Материал только удалённого snapshot удалён с его capability; старый thumbnail из другого дня и текущий thumbnail сохранены байт-в-байт, чужой файл остаётся.
- Retention: до `2026-11-28T17:00Z` день 14 ноября имеет возраст 14 и остаётся; 13 ноября удалён. После перехода даты Новосибирска удаляется 14 ноября, 15 ноября остаётся. Startup продолжает сохранённый deleting marker с оставшимся собственным файлом, сохраняя текущий материал.
- In-flight: загрузка валидного MP4 и SMTP отправка управляемо остановлены, затем cleanup сохраняет marker и ждёт подменяемый fal delete. Во время ожидания архив/receive/download/capture/replay закрыты. Успешно подготовленные late media удаляются ещё до завершения cleanup, video metadata/ready не публикуются; отказ вложения после marker не запускает fallback и не фиксирует sent. После cleanup delivery rows отсутствуют.
- fal: локальный fetch проверяет `POST https://rest.fal.ai/storage/files/delete`, JSON `{file_url}`, серверный Authorization и deadline; известный URL дедуплицируется. HTTP 403 пишет `FAL_DELETE_FAILED`, локальное удаление успешно; 204 отдельно обработан. [Официальный контракт](https://fal.ai/docs/documentation/model-apis/fal-cdn#deleting-files) проверен 2026-11-14.
- UI: operator без кнопки; admin cancel — 0 DELETE, 0 запросов галереи, строки/файлы идентичны. Confirm — ровно 1 DELETE, 0 переходов в галерею, соседний день доступен. Подтверждение использует native dialog; mobile 375 px без горизонтального overflow. [Подтверждение](cleanup-confirmation.png), [после удаления](cleanup-after-mobile.png). Archive regression проверяет оба аккаунта, snapshots, реальные видео и прежнее скрытие публичной карточки; [archive observations](archive-observations.json).

Первый общий прогон остановлен: один прежний generation fixture запускал второй app с реальными часами поверх январских данных и зависал в ожидании submit после новой retention. Тест получил тот же управляемый январский `now`; повторный полный прогон 66/66 PASS.

## Ограничения и передача

Реальные fal delete/генерация/SMTP не выполнялись; транспорта с предоставленным доступом `assets:write` нет. Удаление внешней существующей копии и внутренних данных модели не подтверждено. Отправленное письмо не отзывается; его локальная ссылка закрывается. Камера и production acceptance исключены из задачи. Native Playwright использован по разрешённому fallback вместо отсутствующего `ui_qa`.

Код готов к независимому red-verify. Lifecycle оставлен `in_progress`; commit/push и закрытие принадлежат root.
