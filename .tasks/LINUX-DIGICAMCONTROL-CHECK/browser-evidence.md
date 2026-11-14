# Browser evidence — 2026-11-14

- `node .tasks/LINUX-DIGICAMCONTROL-CHECK/browser-check.mjs`: PASS, Chromium. Отдельный mock-сервер на случайном loopback-порту, временные данные; после проверки процесс и данные удалены.
- Три ручные серии: 9 уникальных JPEG/SHA-256, каждая галерея содержит 3 декодированных изображения 960×640. Явная маркировка DEMO, 3 локальных POST `/test-upload` → 200. Кнопка повторного запуска активна; автоматической новой серии нет.
- Ошибка `/filelist.json` 503 показана пользователю; кнопка доступна, скачанный журнал содержит четвёртый ручной запуск. Ошибок JavaScript нет. Данные: [browser-report.json](browser-report.json), [журнал сервера](browser-server.log), [скачанный журнал](downloaded-browser-log.txt).
- Просмотрен [mock-скриншот результата](linux-success.png): три синтетических изображения, DEMO-результат, повторный запуск и журнал видимы. [Начальный экран](linux-ready.png).
- `node .tasks/LINUX-DIGICAMCONTROL-CHECK/hardware-browser-check.mjs`: PASS на основном localhost:5513 с `/dev/video0` (HD User Facing). Одна ручная серия: три реальных JPEG 1280×720 декодированы Chromium; локальный upload 200, размеры и SHA-256 совпадают с опубликованными файлами. `Simulated:false`, DEMO отсутствует, повтор доступен, автоматической серии и JS-ошибок нет. [Метаданные](hardware-browser-report.json). Скриншоты реальных фотографий не сохранялись; основной сервер не остановлен.

В комплектном Python browser smoke исправлена проверка журнала: закрытый `<details>` давал пустой `inner_text()`. Теперь тест открывает журнал перед assertions. Продуктовый HTML не изменён. Штатный тест после исправления тоже PASS:

```sh
uv run --with playwright python linux_digiCamControl/tests/browser_smoke.py --browser /home/serg/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome
```

Результат: 3 manual runs, 9 JPEGs, 3 local uploads, no automatic rerun, error handling, downloaded log, zero JS exceptions. Python Playwright установлен только во временное окружение uv; browser download и изменения зависимостей проекта не выполнялись. `py_compile` и `git diff --check` прошли.

Проверки не подтверждают Windows/Canon, gPhoto2, Live View, внешнюю загрузку в ReelMe или качество физических снимков.
