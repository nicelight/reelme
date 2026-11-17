# Production: выбор истории

Утверждённый оператором прототип перенесён в рабочий capture UI. Визуальный источник и принятые правила: [DESIGN.md](../../DESIGN.md), [прототип](../../src/client/capture/story-prototype/StoryPrototype.svelte).

Карусель объединяет все страницы существующего catalog API в одну последовательность всех доступных слотов; пять карточек — только видимое окно. Реальные описания, thumbnails и preview загружаются через ProtectedMedia с installation authorization. Повторная загрузка и возврат фокуса обновляют доступность; исчезнувший выбранный слот удаляется вместе с устаревшим `#slot`. При нуле слотов нет карточек, заменителей и CTA старта. CTA использует прежний begin/session flow и блокируется на время смены центра, исключая старт предыдущего сюжета.

## Проверки

- [check.log](check.log): `npm run check`, exit 0, Svelte 0 errors / 0 warnings и server TypeScript без ошибок.
- [build.log](build.log): финальный `npm run build:client`, exit 0; включает мобильное исправление перехода при изменении viewport.
- [browser.log](browser.log): прошли camera.spec.ts (планы 1/4, retry, следующий посетитель) и оба capture-controls.spec.ts (пауза/пересъёмка, восстановление после потери локальных кадров). В этом промежуточном прогоне два других теста ещё не прошли; окончательные результаты ниже.
- [browser-final.log](browser-final.log): capture.spec.ts прошёл — 13 слотов из нескольких API-страниц, protected blob media, setup, durable start / lost acknowledgement, очистка недоступного выбора при focus, состояния 3/2/1/0. Transfer в этом промежуточном прогоне ожидал старый inert CTA; проверка исправлена ожиданием заголовка актуального центрального сюжета.
- [transfer-final.log](transfer-final.log): transfer.spec.ts прошёл после этого исправления — повторная отправка того же Blob, потеря ответа finalize, два посетителя, сохранность кадров и восстановление после перезапуска. Итого все пять focused integration tests имеют успешный результат.
- Независимый functional browser review: PASS; [наблюдения](review/observations.json), визуально подтверждены [1672px](review/production-1672.png), [переход](review/production-transition.png), [fallback](review/production-video-fallback.png). На 1280px подтверждена DOM-ширина центра 512px; [PNG](review/production-1280.png) ненадёжен как визуальное evidence и не подтверждает художественную приёмку этого размера. Дополнительные снимки рабочего каталога и мобильного состояния: [catalog-regression](catalog-regression/).

## Границы

Production-изменения: [App.svelte](../../src/client/capture/App.svelte), [ProtectedMedia.svelte](../../src/client/capture/ProtectedMedia.svelte), [StoryCatalog.svelte](../../src/client/capture/story/StoryCatalog.svelte), локальные `story/motion.ts` и `story/assets/`. Адаптированы существующие capture, camera, capture-controls и transfer browser tests. Server, shared contracts, package/config, cloud/results и камера не изменялись этой реализацией.

Проверки использовали изолированные HTTP/SQLite fixtures, синтетические изображения и управляемый camera transport. Реальная камера, fal, production-данные и развёртывание не проверялись и не изменялись. Коммит и публикация не выполнялись. Итоговая оценка ощущения движения на реальной установке остаётся за оператором.
