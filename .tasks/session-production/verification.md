# Production-перенос фотосессии — 17 ноября 2026

Реализован утверждённый экран в `src/client/capture/session/PhotoSessionView.svelte` и `session.css`. `Capture.svelte` сохраняет camera/JPEG ownership, `PhotoSession.svelte` — upload/finalize/reload-loss. Данные сюжета берутся только из `status.story` и защищённого session thumbnail endpoint; fallback не подменяет snapshot текущим каталогом. Production не импортирует прототип или демонстрационные изображения.

Рабочий вход сохраняется: `http://localhost:5513/reelme.html`. Приложение собирается обычным `npm run build`; deployment/commit/push не выполнялись.

## Результаты

- Финальный `npm run check` — PASS, 0 ошибок и предупреждений.
- Финальный `npm run build` — PASS после semantic main исправления.
- Шесть уникальных browser cases прошли в отдельных прогонах: camera; pause/restart/retake/person-boundary/pending JPEG; group/reload-loss; новый production view smoke; catalog/durable start; transfer/retry/finalize/two visitors.
- `git diff --check` для изменённых capture/test файлов — PASS.
- Главный агент дополнительно проверил controller/dialog код и rich 1920/1280. Геометрия, порядок кнопок и свет сохранены.

Это не один зелёный запуск всей suite. Первый запуск завершил assertions camera, но fixture teardown превысил 120 секунд. Два следующих controls cases прошли, production smoke записал успешные assertions, затем запуск остановлен из-за повторного зависания teardown. В `tests/browser-fixture.ts` введён предел 5 секунд на остановку собственного изолированного server child с SIGKILL fallback и закрытие локальных HTTP connections; production shutdown не менялся.

После этого targeted run дал PASS: camera 34.0s, group/reload-loss 6.2s, production smoke 8.3s, catalog 10.0s. Transfer остановлен на ожидании `main` после Finish: fullscreen перенос убрал прежний общий landmark. Исправлена семантика wrapper в не-capture состояниях, затем повторены check/build и только transfer — PASS 35.6s (runner 37.9s). Успешные остальные cases не повторялись после этой локальной правки.

## Доказательства

- [Первый полный controls проход](controls-observations.json): pause 3/2/1, restart, retake сразу убирает миниатюру, person boundary, pending JPEG retry без второго спуска, сохранены исходные JPEG.
- [Camera](final/camera-observations.json): один спуск на кадр, same-file retry, byte equality, mirror только preview, отсутствие credential leak и pageerror.
- [Reload loss](final/reload-loss-observations.json): принятые сервером кадры не переснимаются/не удаляются; потерянные локальные JPEG останавливают передачу.
- [Production view](final/production-session-observations.json): два синхронных countdown; stagger 0/200/400; pause во время pending capture сохраняет один JPEG и останавливает продолжение; отмена диалога на границе людей не запускает второго; retake уменьшает миниатюры; подтверждённая смена сюжета возвращает каталог без upload/delete.
- [Transfer](transfer-final/transfer-observations.json): исходные Blob/bytes при retry, потерянное finalize acknowledgement, номер только после подтверждения, два посетителя до генерации, сохранение после restart fixture.
- [1920×1080](final/production-session-1920.png), [1280×720](final/production-session-1280.png), [отсчёт](final/production-countdown.png), [граница второго человека](final/production-person-boundary.png). Для этих снимков fixture загружал в изолированный backend изображения из предоставленного референса; они не входят в production assets.

## Изменённая область и ограничения

Новые: `src/client/capture/session/PhotoSessionView.svelte`, `session/session.css`.
Обновлены: `Capture.svelte`, `PhotoSession.svelte`, минимальный fullscreen branch в `App.svelte`, UI selectors/checks в `tests/camera.spec.ts`, `capture-controls.spec.ts`, `capture.spec.ts`, bounded cleanup в `browser-fixture.ts`. Backend/DTO/контракт snapshot story и memory обновлял главный агент отдельно.

Браузерные проверки использовали настоящий Svelte/API/SQLite и управляемые ответы камеры. Canon, Windows, физический звук и реальная digiCamControl Live View не проверялись. Production screenshot подтверждает работу настоящего компонента с тестовыми данными, не подключённое оборудование. Узкий экран сохраняет масштабированную композицию; отдельный мобильный дизайн не вводился. JPEG не сохраняются браузером после перезагрузки; существующая защита lost-local остаётся.
