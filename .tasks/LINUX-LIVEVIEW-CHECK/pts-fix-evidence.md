# Исправление повторяющихся PTS и скрытия превью

Причина воспроизведена: MJPEG encoder завершался с `Invalid pts <= last`, когда
UVC timestamps после преобразования в encoder timebase совпадали. Проверка
отсутствия процесса через 16 с ошибочно считала такое завершение idle cleanup.
[Первоначальный отчёт](process-report.json) помечен недостоверным; исходные журналы сохранены.

В `WebcamBackend.stream_command()` после warmup добавлен
`setpts=N/(FRAME_RATE*TB)`: PTS определяются номером кадра и номинальной частотой
потока, а не колебаниями UVC timestamps. Input FPS, устройство, JPEG-содержимое и
механизм capture не меняются; автоматических рестартов нет. Подход соответствует
[описанию setpts](https://ffmpeg.org/ffmpeg-filters.html#setpts_002c-asetpts).
`FRAME_RATE` использует известную номинальную частоту текущего V4L2-источника.

В `web/liveview.html` добавлено `#preview[hidden] { display:none; }`: авторский
`img { display:block }` больше не перекрывает скрытие изображения после ошибки/stop.

## Проверки

- [PTS RED](pts-red.log): новый regression с настоящим FFmpeg и повторённым каждым
  входным timestamp упал с `Invalid pts (1) <= last (1)`, returncode 234.
- [PTS GREEN](pts-green.log): тот же regression выдаёт все 60 JPEG; все 5 целевых
  Live View тестов прошли. Затем полный Python suite: **29/29 PASS** —
  [full-suite-after-pts.log](full-suite-after-pts.log).
- [Browser RED](browser-recovery-red.json): после injected 503 hidden=true,
  display=block, картинка визуально оставалась видимой — FAIL.
- [Browser GREEN](browser-recovery-report.json): display=none, кнопка Start доступна,
  ошибка видна; повторный Start восстанавливает реальное превью, stop скрывает его,
  JS ошибок нет. [Сценарий](browser-recovery-check.mjs).
- Длительный реальный прогон: **120,16 с**, **541** полностью декодированный свежий
  preview 1280×720 и **6** capture с совпадающими SHA-256; ни одного последовательного
  одинакового hash, один неизменный FFmpeg PID, без encoder errors. Устойчивость — PASS.
  [Отчёт](endurance-report.json), [сценарий](endurance-check.mjs), [журнал](endurance-server.log).
  Общий pass этого первоначального объединённого прогона оставлен false: его idle-часть
  прервала пользовательская вкладка, продолжив polling и отправив Hide. Это отдельно
  обозначено как inconclusive, а не ошибка исправленного encoder.
- Отдельный изолированный physical idle: **PASS** — более 20 с успешного polling с живым
  FFmpeg, затем 17 с без запросов, подтверждено сообщение «нет запросов 15 с», процесс
  отсутствует, EOF/encoder errors не было. [Отчёт](idle-report.json),
  [сценарий](idle-check.py), [журнал](idle-server.log).
- `py_compile` и `git diff --check` — PASS.

Node-сервер и TS/Svelte клиент не менялись. Снимки остаются локально;
скриншоты реальных кадров не сохранялись. Это проверка текущей HD User Facing,
не всех V4L2-устройств, gPhoto2/Canon или Windows.

Обновлённый сервер оставлен работающим на `127.0.0.1:5513`, PID **669029**,
сессия `data/session-20261114T124739-5bbc1249/`. Live View после idle остановлен,
камера свободна. Для новой CSS-правки нужно перезагрузить открытую вкладку.
