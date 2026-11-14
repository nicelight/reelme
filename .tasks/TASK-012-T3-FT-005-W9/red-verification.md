# TASK-012 — независимая семантическая проверка

SEMANTIC_VERDICT: semantic-pass

2026-11-14. В согласованном объёме FT-005 AC-003 / REQ-015, REQ-018 существенных нарушений не обнаружено. Проверены frozen source diff, новые cleanup/availability модули, карточка задачи и относящиеся к удалению требования, контракты доступа/хранения/модульных границ и lifecycle. Bookkeeping других задач исключён.

## Доказательства

- Независимый повтор `node --import tsx --test tests/cleanup.test.ts`: **4/4 PASS**, [red-cleanup.log](red-cleanup.log). Admin-only DELETE и Origin; сегодня/будущее отклоняются; собственные записи/медиа/ссылки исчезают; чужие snapshots и текущие материалы сохраняются. Retention оставляет возраст 14 и удаляет возраст 15 при переходе полуночи Asia/Novosibirsk. Startup завершает сохранённый deleting; marker закрывает новые операции и позднюю публикацию generation/email. Ошибка fake fal delete фиксируется и не мешает local cleanup.
- Два независимых probe: **2/2 PASS**, [red-independent.log](red-independent.log). Задержанный `client.result` вернулся после полного удаления дня: известный URL передан fake delete, новая публикация, job и каталог не появились. Материал старого snapshot пережил удаление первого дня, затем удалён вместе с provider capability только после удаления последнего использующего дня; файл текущего слота сохранился байт-в-байт, сегодняшний день остался, `PRAGMA foreign_key_check` пуст.
- По коду: `remove` сохраняет marker до первого await; startup cleanup предшествует восстановлению публикации/запуску workers. Scenarios синхронно проверяет текущие slots и snapshots других дней перед удалением кандидатов. Guard после асинхронных стадий generation, перед fallback SMTP и перед ready/sent исключает позднюю публикацию в удаляемый день. API проверяет роль/дату независимо от клиента.
- UI проверен по `Archive.svelte`, исполняемому browser test и [observations](cleanup-browser-observations.json): отдельная кнопка admin, native dialog, cancel без DELETE/перехода/изменения файлов и строк; confirm ровно один DELETE, соседний день доступен. Этот browser run выполнен исполнителем; повторного браузерного запуска в review не было.
- Прочитаны исходные [evidence](evidence.md) и логи: полный suite 66/66, check 0 errors/warnings, build, Chromium 2/2 PASS. Они не выдаются за новые независимые прогоны. Фиксация одинакового `now` во втором app прежнего generation test соответствует январскому fixture и устраняет побочный запуск новой retention по реальным часам.

## Границы

Destructive probes использовали только собственные `mkdtemp` SQLite/media; пути и удаление fixtures записаны в логах. Рабочая БД не открывалась. Внешних сетевых удалений не было: fal только fake transport. Реальные fal delete/SMTP, удаление существующей CDN-копии/внутренних данных модели, камера и production acceptance не подтверждены и исключены разрешённым scope. Отправленное письмо не отзывается; закрытие его локальной ссылки проверено.

Исходники, specs и lifecycle не менялись. Дальнейшее действие: root может принять разработку с указанными ограничениями и выполнить разрешённое закрытие; дополнительных исправлений по review не требуется.
