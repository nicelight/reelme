# Результат продолжения — 20 ноября 2026

Промогалерея и перенос слотов завершены; фактические проверки — [TASK-028](../.memory-bank/tasks/TASK-028-T2-FT-001-W25.task.json),
размещение, backup/rollback и текущий image — [ранбук](../deploy_to_nskserver.md).

- На nskserver работает `reelme:20261119T202532Z-993844d-photobooth` через VPS HTTPS.
- Все 3 локальных слота и 7 материалов перенесены, включая 2 template MP4;
  настройки и файлы проверены. Аккаунты/installation key сохранены; два слота
  остаются в режиме симуляции по исходной конфигурации.
- `/` — публичный StoryCatalog без выбора/съёмки; `/admin` — редактор admin;
  `/operator` — сегодня/архив и `/results` — fullscreen обеих ролей. Старый URL
  `/?screen=results` перенаправляет на `/results`.
- Check/build PASS; 120 API/shared тестов и 20 UI сценариев подтверждены. Default
  parallel API run имел transient camera abort failure; полный serial PASS.
  Production API/slots/browser smoke PASS, один первоначальный connect timeout
  не повторился при полном smoke. Доказательства в `.tasks/TASK-028-T2-FT-001-W25/`.
- Инструкция камеры — [MANUAL](../docs/MANUAL.md): localhost:5513/reelme.html
  на ПК с камерой, production loader origin не менять, ключ вводится через #setup.
  fal/SMTP не настроены, реальная камера/генерация/почта не проверены.
- По последующему запросу оператора изменения включены в коммит для `main`.
  Посторонний `.directory` не включён.

Дополнение: [TASK-029](../.memory-bank/tasks/TASK-029-T1-FT-002-W26.task.json) — вкладка «Фотобудка», native details и download готовой страницы; локальный QA/check/build и серверный build PASS, деплой healthy. Production browser PASS: вход, инструкция, download, desktop/mobile closed/all-open. Первый font-loading timeout записан; повтор прошёл, logout выполнен.
