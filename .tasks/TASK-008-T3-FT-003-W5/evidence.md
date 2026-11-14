# TASK-008 — выдача готового результата

Реализованы отдельные постоянные receive/download capability-токены, ready-публикация
после проверки сохранённых видео/кадра/основного фото, startup recovery и внутренняя
проекция readyCard для будущего общего экрана. Страница /receive/:token показывает
основное фото/номер, принимает email, опрашивает текущее состояние и позволяет повтор
только после failed. SQLite атомарно сохраняет email/pending и первое подтверждение;
opened не запускает срок и повтор не переносит первое подтверждение. SMTP отсутствует.

## Фактические проверки

| Проверка | Результат и доказательство |
|---|---|
| npm run check | PASS, 0 errors/0 warnings — [check.log](check.log) |
| npm run build | PASS — [build.log](build.log) |
| npm test | PASS 40/40, включая прежнюю генерацию всех моделей — [api-check.log](api-check.log) |
| npx tsx --test tests/receive.test.ts | PASS 4/4 — [receive-check.log](receive-check.log) |
| Chromium, tests/receive.spec.ts | PASS 1/1 — [browser-check.log](browser-check.log), [наблюдения](browser-observations.json) |
| git diff --check | PASS |

API/SQLite/FFmpeg: две сессии получают разные токены и собственные фото/видео;
неверный и перекрёстный токен возвращает 404, receive-токен не авторизует аккаунтные
или capture-действия. Скачанные байты равны подготовленному MP4 до/после рестарта.
Удаление сессии отзывает ссылки. Отсутствующие/повреждённые видео и кадр не публикуются
как ready; безопасная ошибка доступна через capture-state. Проверена публикация
из штатного generation callback без нового submit и без подтверждения email.
Подробности без секретов: [api-observations.json](api-observations.json).

Email: неверный адрес отклонён, два конкурентных подтверждения дали 200 и 409;
pending/sending/sent запрещают повтор, failed разрешает исправление. После повторов
и рестарта первое подтверждение осталось 1767225620000; открытие 1767225600000
его не создало. Пропущенное opened восполняется подтверждением. Генерация сохраняет
ready во всех email-состояниях. [email-observations.json](email-observations.json).

Реальный Chromium: 375×812 light и 1280×900 dark/reduced-motion; оригинальный JPEG
загружен; нативная и серверная валидация, pending без ложного sent, polling sending,
failed/исправленный адрес, pending после рестарта, sent после локальной установки
состояния. Через браузер скачан MP4 с побайтовым совпадением. Page errors нет,
горизонтального overflow на 375px нет. Скриншоты просмотрены:
[мобильная форма](receive-mobile.png), [pending](receive-pending.png),
[повтор desktop dark](receive-retry-desktop-dark.png), [sent](receive-sent-desktop-dark.png).

## Ограничения и передача

Использованы синтетические JPEG/MP4, настоящие SQLite/FFmpeg и Chromium.
fal и SMTP не вызывались; sending/sent/failed в браузере задавались локально.
Реальная доставка, QR/общий экран, публичный таймер и архив принадлежат следующим задачам.
Пока почтовый обработчик не подключён, форма остаётся pending. ui_qa launcher отсутствует
в PATH; по указанию оркестратора использован project-native Playwright. Первый запуск
нового browser-теста упал при импорте Fastify в Playwright; fixture исправлена на
запуск собранного сервера отдельным процессом, финальный проход выше успешен.

Реализация и тестовые входы заморожены для независимой проверки:
[inputs.sha256](inputs.sha256), проверка `sha256sum -c .tasks/TASK-008-T3-FT-003-W5/inputs.sha256`.
Карточка оставлена in_progress; lifecycle, commit и push — у оркестратора.
