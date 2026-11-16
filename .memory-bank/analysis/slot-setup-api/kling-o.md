---
type: research
checked: 2026-11-16
status: researched
---
# Kling O1/O3 — ограничения редактора слотов

Проверены публичные схемы fal и официальные руководства Kling; платных запросов
и проверки качества не было. [Матрица](../../../docs/slot-setup/matrix.md) содержит поведение
продукта; ниже отделены факты API от предлагаемых ограничений ReelMe.

## Входы

| Endpoint | Бюджет без видео-Elements | Промпт | Выходные параметры |
|---|---|---|---|
| `fal-ai/kling-video/o1/video-to-video/edit` | `len(elements)+len(image_urls) ≤ 4` | Обязательный, ≤2500 символов; `@Element1`, `@Image1`; исходное видео надёжнее называть обычными словами | Ни `resolution`, ни `aspect_ratio` нет |
| `fal-ai/kling-video/o3/pro/video-to-video/edit` | `len(elements)+len(image_urls) ≤ 4` | Обязательный, ≤2500; `@Element1`, `@Image1`, исходное видео `@Video1` | Ни `resolution`, ни `aspect_ratio` нет |
| `fal-ai/kling-video/o3/pro/reference-to-video` | До 7 images/elements без видео по официальному Kling guide; точный fal schema не кодирует этот максимум | `prompt` либо `multi_prompt`, не оба; один prompt ≤2500; `@Element1`, `@Image1` | `aspect_ratio`: `16:9`, `9:16`, `1:1`; default `16:9`. `resolution` отсутствует. `duration`: строки `"3"`…`"15"` |

Источники: [O1 API](https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/edit/api),
[O3 Edit API](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit/api),
[O3 Reference API](https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video/api).
Машинные схемы проверены отдельно:
[O1 OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/o1/video-to-video/edit),
[O3 Edit OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/o3/pro/video-to-video/edit),
[O3 Reference OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/o3/pro/reference-to-video).

В трёх схемах массивы `elements` и `image_urls` не имеют `maxItems`; общий предел
в V2V задан описанием, а не JSON Schema. Отдельный более низкий предел Elements
не заявлен. У O3 Reference фраза про 4 содержит условие «when using video».
Официальные [Omni guide](https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide)
и [Element Library guide](https://kling.ai/quickstart/klingai-element-library-3-user-guide)
явно различают 4 при наличии видео и 7 без него. Применение 7 к image-only fal
endpoint — обоснованный вывод из первичных источников, но не проверенный вызовом
fal факт. В текущем объёме нет video-Elements, start/end frames и голосов.

Оператор принял предел семь для image-only O3 P2V по документации, без временного
ограничения четырьмя. Неоднозначность сохранена как граница доказательства;
если реальные запросы выявят расхождение, правило уточняется при отладке.

## Ракурсы и групповые фотографии

Фото-Element: основной `frontal_image_url` плюс 1–3 `reference_image_urls`, всего
2–4 фото одного объекта. Официальный Element Library guide подтверждает минимум
два. OpenAPI допускает отсутствие некоторых полей и не задаёт `minItems`, однако
это не отменяет текстовое ограничение. O1 требует frontal на уровне схемы;
у O3 оба поля nullable/необязательны. Не считать эту разницу разрешением
отправить пустой Element или один фронтальный кадр.

Оператор подтвердил для «человек = Element»: индивидуально разрешить
2/3/4 кадра, вариант 1 отключить с объяснением. Не дублировать файл ради минимума.
Для группы доступны 1–4 обычных изображения без Elements.

Внутренние ракурсы не занимают отдельные единицы общего бюджета. При двух
Elements по четыре фото остаётся два обычных изображения в V2V; для O3 P2V
при принятом пределе 7 — пять. При `3+` отправлять K групповых кадров первыми
в `image_urls`, без Elements; остаток V2V — `4-K`, image-only O3 P2V — `7-K`.
Групповой контент не запрещён описанием ordinary refs, но автоматическое выделение
всех лиц и сохранение личности каждого человека этими схемами не гарантируется.

## Файлы и геометрия

| Вход | Проверенные ограничения |
|---|---|
| O1 исходное видео | MP4/MOV; 3–10 с; обе стороны 720–2160 px; 24–60 fps; 200 MiB по `x-fal` (страница подписывает MB) |
| O3 Edit исходное видео | MP4/MOV; 3–15 с; обе стороны 720–3840 px; 23–60 fps; 200 MiB по `x-fal` |
| Фото для всех трёх | Каждая сторона ≥300 px; width/height 0.4–2.5; до 50 MiB по `x-fal` |

Для подготовки файлов использовать целые длительности внутри диапазона, не
зависеть от технического допуска 0.05 с в схемах. 1920×1080 и 1080×1920 подходят
по размерам обоим V2V; это проверка входа, а не обещание размеров выхода.
`keep_audio` по умолчанию false у O1, true у O3 Edit.

Kling как продукт поддерживает 720p/1080p, но это не создаёт поля `resolution`
в выбранных fal endpoint. [Сравнение fal](https://fal.ai/learn/devs/kling-4-0-vs-kling-3-0)
прямо отмечает отсутствие `resolution` у Pro и описывает tier до 1080p; статья
содержит устаревшие относительно текущей схемы параметры входного O3-видео, поэтому
размеры/длительность выше взяты из актуального OpenAPI. Нельзя показать рабочий
переключатель native 720/1080 и отправить выдуманное поле. Оператор подтвердил:
показывать только реальные API-варианты, без дополнительной обработки результата.
Для V2V ориентацию шаблонного ролика можно проверять до запуска; документированной
гарантии смены выходной ориентации текстовым промптом нет. Для P2V отправлять
`16:9`/`9:16`; квадратный `1:1` — отдельное продуктовое решение, не горизонталка.

## Шаблоны и выбранная трактовка

- [O1 Edit](../../../public/slot-prompts/kling-o1-edit/people-1__photos-4__refs-0.md).
- [O3 Edit](../../../public/slot-prompts/kling-o3-edit/people-1__photos-4__refs-0.md).
- [O3 Reference](../../../public/slot-prompts/kling-o3-reference/people-1__photos-4__refs-0.md).

Ссылки выше — примеры готовых промптов, не гарантии качества. Все варианты
сформированы офлайн и выбираются целиком по [машинному каталогу](../../../docs/slot-setup/prompt-catalog.md),
без runtime-подстановок, описания слота и текстового AI inference.
V2V сохраняет действие, камеру и обстановку источника;
P2V предлагает спокойный cinematic portrait и учитывает переданные фото сцены.
Применение image-only предела 7 остаётся документированным выводом выше. V2V требует
понятного соответствия людей в ролике посетителям; порядок «первый слева,
второй справа» ниже — редактируемая конвенция шаблона, не функция распознавания.
