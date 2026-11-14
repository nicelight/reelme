# ReelMe — независимый аудит продуктовых сценариев

Дата: 2026-11-14. Baseline: `5d2696632620a12107de52f67bb488b31a29877c`.

**VERDICT: FAIL. SEMANTIC_VERDICT: semantic-fail.** Найдено одно воспроизводимое нарушение FT-004-AC-002 (P2). Остальной проверенный scope не выявил существенных нарушений. Этот verdict относится к описанному функциональному аудиту, не заменяет аппаратную/production-приёмку.

Применён подход `verify` и `red-verify`: сопоставлены PRD, AC FT-001–FT-005, lifecycle/integrations/HTTP/access/data contracts, текущая реализация и актуальные локальные доказательства. Исходники, спецификации, задачи и их статусы не менялись. Все DB/media временные; внешние fal/SMTP-вызовы и рабочая БД не использовались.

## Существенная находка

### PRODUCT-01 · P2 · Промоэкран обрезает QR при высоте окна 720/768 px

**Код:** `src/client/cloud/Display.svelte:28` определяет вместимость преимущественно по ширине; `:132`, `:152`, `:153` задают высоту изображений/QR и уплотняют карточки лишь при высоте от 1300 px. Высота шапки и всей карточки не сопоставляется с доступной высотой окна.

**Принятый критерий:** FT-004-AC-002 / REQ-011 и PRD «Публичный прогресс и промоэкран»: на общем экране готовая карточка содержит фото, кадр, QR и крупный номер; при переполнении страницы карточек переключаются каждые 10 секунд. QR — основной переход посетителя к форме без взаимодействия с операторским экраном.

**Достижимое воспроизведение:** открыть общий экран оператором, имея готовые сегодняшние сессии; viewport 1280×720 либо 1366×768, обычный масштаб, `scrollY=0`. В probe восемь сессий с реальными проверенными MP4/JPEG; фоновая генерация и внешняя почта выключены. Сессии подготовлены существующим тестовым fixture, состояние `ready` и capability выдаёт настоящий backend. Выполнить:

```sh
node --import tsx .tasks/PROJECT-AUDIT-2026-11-14/astra-product/display-probe.ts
```

**Наблюдается:** при 1280×720 три карточки имеют QR от y=684.656 до y=838.656; видна лишь верхняя часть QR. При 1366×768 QR заканчивается на y=841.844 и также обрезан. Через 10 секунд номера меняются 1/2/3 → 4/5/6, но QR остаются за нижней границей. DOM-видимость и сам факт пагинации не гарантируют видимость кода в viewport.

**Ожидается:** полностью видимые и сканируемые QR текущей страницы без ручной прокрутки общего промоэкрана; автоматическое перелистывание должно показывать следующую полноценную страницу.

**Влияние:** посетитель на таком экране не может сканировать QR без вмешательства сотрудника и прокрутки. Это нарушение основного пути выдачи на указанных размерах. На 1440×900, 1920×1080 и 1920×1300 QR в probe помещаются; находка не распространяется на эти размеры.

**Минимальное направление исправления:** компактный layout для небольшой высоты с учётом шапки, карточки и QR; выбирать вместимость по реально доступной области. Одного уменьшения числа карточек в строке недостаточно, если высота одиночной карточки остаётся прежней. Зафиксировать проверку полного QR bounding box на 1280×720/1366×768 и после автоматической смены страницы.

**Доказательства:** [размеры и координаты](display-viewport-observations.json), [переход страницы](display-paging-viewport.json), [1280×720](display-viewport-1280x720.png), [1366×768](display-viewport-1366x768.png), [после автоматического перелистывания](display-1280x720-after-automatic-page.png). Изображения просмотрены аудитором. [Probe](display-probe.ts), [отдельный сервер fixture](display-probe-server.ts), [лог](display-probe.log).

## Проверенный scope

| Функция | Проверенные пользовательские пути и границы | Результат |
|---|---|---|
| FT-001 | Editor обоих режимов; 11 моделей, prompt/resolution/duration/media validation; скрытие, 12+1 каталог, detail/demo; права; неизменность settings/media snapshot после редактирования и рестарта | Существенных нарушений не обнаружено |
| FT-002 | Камера 1/4 позы, порядок, оригинальные JPEG против зеркального preview, WebAudio countdown, fallback; задержанный JPEG, lost shutter ack и повтор того же файла; отдельный ключ; retry upload/finalize; два посетителя до окончания первой генерации; дата/номер при переходе полуночи | Локальные управляемые сценарии прошли; hardware исключён |
| FT-003 | Все 11 payload adapters; 12 свежих payloads десяти дополнительных endpoints против сохранённых официальных схем; Recast без prompt и с одним фото; роли и порядок остальных фото; P2V demo excluded; stable URLs/snapshot; подтверждённый request ID, restart, submit/poll/download failures; настоящий FFmpeg decode и own ready capabilities | Существенных нарушений не обнаружено; live fal не проверялся |
| FT-004 | Ready→receive→email; исходное фото нужной сессии; SMTP attachment byte identity, link fallback, definite vs uncertain error, manual correction/retry, prohibition after sent; шесть стадий, masking; реальный raster QR decode; 10-second paging; 179/180-second deadline с retry/restart/offline и сохранением файлов | Штатные сценарии прошли; дополнительный viewport probe выявил PRODUCT-01 |
| FT-005 | Past Novosibirsk dates, daily numbering, totals, исторические thumbnail/video, operator/admin viewing; сохранение после публичного скрытия; cancel/confirm deletion, role/API restrictions, today exclusion, exact retention boundary, shared/other event data сохранены, закрытие capability URLs | Существенных нарушений не обнаружено |

## Выполненные проверки

- `npm run check` — PASS, Svelte 0 ошибок/0 предупреждений, серверная проверка типов прошла: [check.log](check.log).
- `npm run build` — PASS: [build.log](build.log). Browser inputs собраны до запуска suite и далее не менялись.
- `npm test` — **66 passed, 0 failed, 0 skipped**, 43 верхнеуровневых subtests: [tests.log](tests.log). Включает реальные временные SQLite/files, FFmpeg и loopback SMTP.
- `npm run test:ui` — **9 passed (2.3m)**, Chromium: archive, camera, catalog/start, cleanup, display, editor, email, receive, transfer: [browser.log](browser.log), [артефакты](browser/). Browser backend fixtures — отдельные процессы. Полный список сценариев виден в логе; проверялась применимость текущему baseline.
- `uv run --with jsonschema==4.26.0 …/validate-schemas.py` — **12 свежих payloads / все 10 дополнительных endpoints PASS** по required/types/enums/ranges/nested refs и отсутствию неизвестных полей: [schema-validation.log](schema-validation.log), [schema-validation.json](schema-validation.json), [свежие модельные наблюдения](models/model-observations.json). Источник — `.tasks/TASK-007-T2-FT-003-W5/official-schemas.json`; сохранённые схемы переиспользованы, прежние PASS не подменяют новую проверку payloads.
- Дополнительный display probe — пять размеров viewport и реальное автоматическое переключение страницы; наблюдаемое нарушение описано выше.

## Ограничения

Реальные fal inference/SMTP.BZ отправки на этапе разработки отменены оператором. Этот аудит не доказывает текущую живую совместимость каждого endpoint, качество AI, доставку внешней почты или особенности SMTP-тарифа. Модельная проверка использует сохранённые официальные схемы, а не повторное получение живых схем. Canon/digiCamControl на Windows, production VPS/domain и TASK-005 исключены; отсутствие этих прогонов не трактуется как дефект. Камера проверена управляемым HTTP, WebAudio — событиями браузера, не физическим звуком.

Ряд browser fixtures задаёт промежуточные состояния непосредственно для проверки UI; для их происхождения отдельно применимы выполненные API/worker tests. Эти fixtures не выданы за полный реальный проход внешних сервисов. Security/state/data аудит выполняется другим независимым аудитором; данный отчёт не подменяет его выводы.
