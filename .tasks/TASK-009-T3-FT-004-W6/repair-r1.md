# TASK-009 — коррекция R1, попытка 2/3 (retry 1/2)

2026-11-14. Исправлена подтверждённая [находка R1](red-verification.md):
`552 5.2.2 Mailbox size limit exceeded` ошибочно допускал резервное письмо.
Старые red-report и evidence сохранены без изменений.

`attachmentRefused` теперь сначала исключает enhanced status `4.2.2/5.2.2`
(квота ящика). Явные коды размера сообщения `4/5.3.4` и `4/5.2.3` сохраняют
fallback. Текстовая эвристика использует полные слова message/mail/attachment;
при слове mailbox без явного кода размера сообщения не делает вывод об отказе
вложения. Поэтому и `552 Requested mail action aborted: mailbox size limit exceeded`
не вызывает вторую SMTP-попытку.

## Фактические проверки

- До исправления новый тест точного ответа `552 5.2.2 Mailbox size limit exceeded`
  и его варианта без enhanced status воспроизвёл 2 попытки вместо 1.
  [RED](repair-r1-red.log): две неуспешные вложенные регрессии; родитель также failed.
- После исправления `npx tsx --test tests/email.test.ts` — **18/18 PASS**.
  [Вывод](repair-r1-smtp-tests.log). Настоящий Nodemailer и loopback SMTP:
  точный ответ R1, mailbox без enhanced status, mail-action/mailbox формулировка и
  `5.2.2 Message too large for mailbox quota` дают одну попытку/failed.
  Положительные отказы размера/типа, включая текстовый `552 Message size exceeds limit`,
  по-прежнему дают MP4 → одно письмо со ссылкой, sent после принятия.
- `npm run check` — PASS, Svelte 0 errors/0 warnings, tsc PASS.
  [Вывод](repair-r1-check.log).
- `npm run build` — PASS, клиентская и серверная сборки.
  [Вывод](repair-r1-build.log).
- `git diff --check` — PASS.

UI не менялся и повторно не запускался по назначенному scope: предыдущее
[доказательство Chromium 1/1](browser-tests.log) относится к неизменной форме.
Полный unit suite повторно не запускался; прежние 53/53 не объявляются новым прогоном.
Внешних писем SMTP.BZ и live fal не было. Specs и lifecycle не менялись, карточка
остаётся in_progress; исправленный код заморожен для повторной независимой проверки.
