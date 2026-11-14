# V4L2 Live View — первоначальные проверки, недостаточные для устойчивости

**Первоначальный общий PASS отозван после реального сбоя.** В журнале обнаружены
повторяющиеся PTS и завершение MJPEG encoder через несколько секунд. Короткие
сценарии ниже этого не выявляли. Исправление и повторная проверка:
[pts-fix-evidence.md](pts-fix-evidence.md).

Добавлен Live View для локального Python-сервера. Node backend и TypeScript/Svelte
клиент ReelMe не менялись. Один FFmpeg владеет V4L2 во время preview; capture ждёт
следующий JPEG, публикация файлов использует существующий Controller. Последний
preview хранится только в памяти. Без Live View сохранён прежний одноразовый capture.

Поддержаны Show, `/liveview.jpg`, LiveView_Capture, Hide/Close; HEAD не управляет
камерой. Старый JPEG при сбое/зависании не выдаётся. Idle timeout 15 с нужен потому,
что текущий CaptureClient не посылает stop при закрытии. gPhoto2/mock — 501 для Live View.

## Проверки

- [tests.log](tests.log): 28/28 PASS. Реальные HTTP/FFmpeg на синтетическом входе,
  start/reuse/stop, capture при preview, обычный capture после stop, idle/restart,
  обрыв и зависание потока, отсутствие публикации старого кадра, close/join.
  Traceback в negative cases ожидаем: тесты проверяют ошибку и отсутствие JPEG.
- [adapter-check.mjs](adapter-check.mjs), [adapter-report.json](adapter-report.json):
  HD User Facing `/dev/video0`, 1280×720 MJPEG, настоящий адаптер ReelMe,
  1+4 снимка при параллельном preview (12 кадров), SHA-256 и полное декодирование;
  отдельный Capture после stop. PASS. Получение снимка адаптером: 520–560 мс.
- [browser-check.mjs](browser-check.mjs), [browser-report.json](browser-report.json):
  Chromium, локальная страница `/liveview.html`, неизменённый адаптер ReelMe
  транспилирован в браузер. 6 preview + 2 capture 1280×720, декодирование браузером,
  stop и отсутствие JS ошибок. PASS. Это проверка страницы/адаптера,
  не полный облачный пользовательский путь.
- [process-report.json](process-report.json): **неподтверждённый idle, прежний PASS отозван**.
  Один FFmpeg и повторное использование PID наблюдались, но отсутствие процесса
  через 16 с оказалось следствием `Invalid pts (183) <= last (183)` на 6-й секунде,
  а не idle timeout. Исходный журнал: `data/session-20261114T120230-d18dedef/server.log`.
- `python3 -m py_compile …/cameras.py …/linux_digicamcontrol.py …/tests/test_live_view.py`
  и `git diff --check` — PASS.

На момент первоначальной проверки сервер был оставлен на `127.0.0.1:5513`, PID 650185, веб-камера `/dev/video0`,
`--size 1280x720 --input-format mjpeg`. Открыть `http://localhost:5513/liveview.html`.
После проверок Live View остановлен, FFmpeg не держит камеру; Show запустит его снова.
Текущая сессия: `linux_digiCamControl/data/session-20261114T120230-d18dedef/`.
Предыдущая сессия `session-20261114T115157-a17ea0be/` сохранена.
Реальные фотографии остаются локально; screenshot/внешних загрузок нет.

Canon/gPhoto2, Windows и физическое выдёргивание USB не проверялись. EOF/зависание
и освобождение worker при close проверены управляемыми subprocess. Первоначальная
проверка реального idle была недостоверна; качество автофокуса/экспозиции не оценивалось.
