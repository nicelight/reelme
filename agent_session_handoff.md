# ReelMe — настройки слотов и управляемая фотосессия

## Текущее состояние

Разработка согласованного обновления завершена: **TASK-016…019 — done**.
Последний исходный коммит оператора — `a082a39` («flexible slot backend»), включающий
TASK-016/017. TASK-018/019 и связанные документы остаются изменениями рабочего дерева.
Агент commit/push/deploy не выполнял. Новая задача не выбрана; продолжать по указанию оператора.

Отвечать по-русски, соблюдать AGENTS.md и KISS. Оператор просит делегировать
подходящие задачи и ждать нужного результата вместо расширения работы. После двух
ответов сабагента «ещё не закончил» увеличить следующий интервал ожидания на минуту.

## Канонические источники

- [Матрица](docs/slot-setup/matrix.md): согласованные настройки, лимиты API, промпты,
  люди/кадры, фиксация/сбросы и управление фотосессией.
- [План и интерфейсы](.memory-bank/analysis/slot-setup-plan.md).
- [Индекс задач](.memory-bank/tasks/index.json): статусы и фактические доказательства.
- [Каталог промптов](docs/slot-setup/prompt-catalog.md).
- [Подготовка роликов](media/template-videos/readme_media.md).

Принятые API-лимиты не обсуждать повторно и не ужесточать для перестраховки.
Не загружать в контекст весь каталог: JSON выбирает один конкретный готовый файл.

## Реализовано

[TASK-016](.memory-bank/tasks/TASK-016-T2-FT-001-W13.task.json): общий setup из JSON,
конкретный snapshot-план до восьми кадров, отдельные Elements для двух людей,
group через ordinary images, optional Recast prompt и реальные output-параметры.
SQLite сохраняющей миграцией допускает позиции 0..7; старые фотографии,
provider FK/токены/URLs, snapshots и request_id сохранены.

Новый setup: participants 1/2/group, photosPerParticipant, orientation, поддерживаемый
aspectRatio. `getSlotSetup`/`buildPosePlan` находятся в shared/slot-setup.ts.
Отсутствие snapshot.posePlan означает legacy с прежними 1/4 и старыми позами;
raw-слот до первого нового save сохраняет прежний путь. Editor projection добавляет
defaults без записи. V2V draft без исходника сохраняется, но не запускается и не
появляется в каталоге.

[TASK-017](.memory-bank/tasks/TASK-017-T2-FT-001-W14.task.json): последовательный
SlotEditor, lock/unlock, сохранение совместимых верхних значений, загрузка готового
промпта без runtime-подстановок. Ручной текст сохраняется при любой смене references
с напоминанием; поздний fetch не затирает правку/новый setup. `/slot-prompts/`
работает с ревалидацией; пустой Recast — валидный ответ.

Каждая позиция нового manual test получает отдельный JPEG из ordered testPhotoIds.
Кеш media IDs разделяет человек/ракурс и group/номер кадра; лишние позиции не
отправляются. Старый testPhotoId остаётся для legacy retry. Snapshot фиксирует
источники теста, cleanup их учитывает; в provider payload тестовые настройки не
попадают. Запущенный тест и последний ready-ролик не исчезают при сбросах формы.

[TASK-018](.memory-bank/tasks/TASK-018-T2-FT-001-W15.task.json): стабильный UUID draft,
именованный импорт исходника, immutable media/provenance и плеер; отдельная страница
пяти образцов, сохранение guide IDs в snapshot, защищённая выдача и cleanup.

- POST slots допускает UUID id в envelope; импорт `/admin/slots/:id/template-video`
  принимает orientation/model и читает `<slot-id>__landscape|portrait.mp4` из
  `TEMPLATE_VIDEOS_DIR` (default `media/template-videos`). Новый import — новый media ID;
  слот меняется после save, не от самой замены файла в папке.
- `slot_media.template_slot_id/template_orientation` проверяют принадлежность.
  Прежний source того же существующего слота допускается при совместимости,
  включая слоты с новым setup, сохранённые до внедрения provenance.
- GET/PUT `/admin/capture-guides[/number]` управляют пятью назначениями.
  GET `/capture/sessions/:id/guides/:number` требует installationKey и читает только
  guideMediaId из saved plan. Образцы не передаются в fal.
- SQLite user_version 9; текущие guide assignments и snapshot-ссылки удерживаются cleanup.

[TASK-019](.memory-bank/tasks/TASK-019-T2-FT-002-W16.task.json): Pause/Continue с полными
3–2–1, Restart с ожиданием запуска, пересъёмка последней завершённой позиции,
ожидание второго человека, образец во время countdown и review после последнего JPEG.
**Только «Завершить фотосессию» начинает передачу.** До него кадры/пересъёмки локальны.

`camera.hasPendingCapture` блокирует второй shutter/restart/retake и после ошибки
ожидания JPEG. Retry получает тот же файл. После Finish повтор передачи использует
те же Blobs, пропускает принятые позиции и не вызывает камеру. Таймеры/URLs
освобождаются при отмене/уходе; legacy SVG остаётся только для старых поз.

Решение оператора KISS: **без IndexedDB**. JPEG хранятся в RAM, в sessionStorage —
только receipt/маркер передачи. После reload с потерянными missing Blobs интерфейс
явно останавливает сессию и предлагает новую; принятые старые кадры не стираются,
не переснимаются и не финализируются как неполный набор. Полный серверный набор
можно дозавершить. Это принятое ограничение, не незавершённая реализация.

## Проверки и границы доказательств

- Итоговые `npm run check` — 0 errors/0 warnings; `npm run build` — PASS.
- Итоговый `npm test` — **91/91 PASS**, без skipped.
- Editor: три прежних browser-сценария и новый materials-сценарий PASS.
- Camera: unit 7/7, browser 5/5 — pause 3/2/1, person boundary, retake/restart,
  pending JPEG retry, group guide 5, no upload до Finish, lost-blobs reload 0/1 accepted,
  отсутствие позднего shutter и последовательные посетители.
- Независимый UI smoke 19 — 1/1 PASS, final bytes/shutter counts проверены.
  Отдельная visual recheck 1/1 подтверждает исправление фонового текста countdown
  на 1440×1000 и 375×812; guide/цифра читаемы, overflow нет.
- Snapshot/media immutability, права/Range/cleanup и legacy provider URL проверены
  изолированными HTTP/SQLite тестами.
- `git diff --check`, ссылки на матрицу в шапках связанных исходников — PASS.
  Prompt assets изменено 0; полного перебора 813 файлов не было.

Evidence находится в `verify` карточек и `.tasks/TASK-018-T2-FT-001-W15/`,
`.tasks/TASK-019-T2-FT-002-W16/`, включая [независимый UI отчёт](.tasks/TASK-019-T2-FT-002-W16/ui-smoke/report.md).
Реальные ролики/образцы пользователь ещё не предоставил: тестовые MP4/JPEG были
только во временных fixture, рабочая папка роликов не заполнялась случайными примерами.
Реальные Canon/digiCamControl, платные fal, SMTP и production не запускались;
аппаратная приёмка остаётся отдельной TASK-005 и не выдается за выполненную.

## Ограничения дальнейшей работы

- Не проверять все 813 промптов: только представительная выборка API-ветвей/границ,
  людей/группы и пустого Recast. Полный `check:slot-prompts` не является обычной приёмкой/CI.
- 11 endpoint, 108 вариантов, 813 окончательных Markdown-файлов. Выбор по
  `promptFiles[фактическое число дополнительных references]`; никакого runtime
  шаблонизатора, Markdown-rendering, описания слота или LLM-переписывания.
- Offline generator — источник каталога; metadata JSON и generator должны совпадать.
  На этапе внедрения prompts не пересоздавались.
- Ссылка `docs/slot-setup/matrix.md` обязательна в начальных комментариях связанных
  исходников, включая косвенных потребителей плана/материалов.
- Не добавлять распознавание лиц/поз, crop/upscale или сложные cache/workflow сервисы.
- Пользовательские TODO и посторонние изменения не трогать автоматически.

Файл мелких находок этой сессии: `PAPERCUTS/GPT-6 __ 11-16-2026 13.45.md`.
