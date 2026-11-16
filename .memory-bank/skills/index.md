---
description: Реестр доступных скиллов (когда применять) в этом репозитории.
status: active
---
# Skills

## Installed
<!-- BEGIN DEVRAILS INSTALLED SKILLS -->

| Skill | Codex `.agents` | Claude `.claude` |
| --- | --- | --- |
| <code>add-tests</code> | yes | yes |
| <code>architecture-review</code> | yes | yes |
| <code>autonomous</code> | yes | yes |
| <code>autopilot</code> | yes | yes |
| <code>constitution</code> | yes | yes |
| <code>context-manifest</code> | yes | yes |
| <code>creator-vibe</code> | yes | yes |
| <code>debug</code> | yes | yes |
| <code>discuss</code> | yes | yes |
| <code>exe</code> | yes | yes |
| <code>feature-doctor</code> | yes | yes |
| <code>feature-to-tasks</code> | yes | yes |
| <code>fill</code> | yes | yes |
| <code>find-skills</code> | yes | yes |
| <code>foundation-to-tasks</code> | yes | yes |
| <code>grill-me</code> | yes | yes |
| <code>kiss-architect</code> | yes | yes |
| <code>map-codebase</code> | yes | yes |
| <code>mb-doctor</code> | yes | yes |
| <code>mb-garden</code> | yes | yes |
| <code>mb-init</code> | yes | yes |
| <code>mb-sync</code> | yes | yes |
| <code>multiagentic</code> | yes | yes |
| <code>multipilot</code> | yes | yes |
| <code>prd-to-features</code> | yes | yes |
| <code>red-verify</code> | yes | yes |
| <code>review-feat-plan</code> | yes | yes |
| <code>review-tasks-plan</code> | yes | yes |
| <code>spec-auto</code> | yes | yes |
| <code>spec-design</code> | yes | yes |
| <code>spec-init</code> | yes | yes |
| <code>spec-redesign</code> | yes | yes |
| <code>start</code> | yes | yes |
| <code>tech-debt</code> | yes | yes |
| <code>technical-premortem</code> | yes | yes |
| <code>verify</code> | yes | yes |
| <code>write-prd</code> | yes | yes |

Используй guidance ниже только для skill, отмеченного как `yes` в активной runtime surface.

<!-- END DEVRAILS INSTALLED SKILLS -->

## Guidance for installed skills
- Bootstrap skeleton: mb-init
- Scenario routing: start
- Creative intent: /creator-vibe before narrower skills when success materially depends on taste, voice, human experience, or unstated choices
- Discovery: /grill-me clarifies raw or uncertain ideas and keeps analysis/brief.md durable; clear authoritative product sources may continue without grilling
- Project principles: /constitution when governing decisions need clarification
- Development flow: intent/requirements → features/design → tasks → implementation/checks → memory; use the commands that help reach these outcomes
- SDD design: /spec-design, /spec-redesign, and /spec-auto help maintain canonical specs; fresh contexts and separate reviews are optional
- Delegated context routing: /context-manifest when broad discovery is more expensive than direct reads
- Map codebase: /map-codebase
- Execution: /exe
- Verification (UAT): /verify
- Semantic adversarial verification: /red-verify
- Autonomous run: autonomous / autopilot
- Readiness doctor: mb-doctor
- Review: /review-feat-plan, /review-tasks-plan
- Maintenance: mb-garden

## Frontend skills (Codex, project-local)

Установлены 2026-11-16 в `.agents/skills/`; существующие DevRails skills сохранены.
Все четыре применяются в существующем стеке ReelMe: без добавления React,
UI-фреймворков и motion-библиотек. JSX/Motion-примеры адаптировать к CSS/WAAPI.
Скиллы не заменяют проектные правила, согласование границ, проверки и разрешение на commit/publish.

| Имя вызова | Каталог | Источник / версия |
| --- | --- | --- |
| `$impeccable` | `.agents/skills/impeccable/` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable), npm installer 4.9.2; skill 4.9.1; engine 0.1.24; project scope, Codex only |
| `$animate` | `.agents/skills/animate/` | [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/animate), `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` |
| `$optimize-web-animations` | `.agents/skills/optimize-web-animations/` | [MengTo/Skills](https://github.com/MengTo/Skills/tree/3cc93458c4949c39a04e938ea7892a1d6d3d40bf/agent-skills/codex/optimize-web-animations), `3cc93458c4949c39a04e938ea7892a1d6d3d40bf` |
| `$prototype` | `.agents/skills/prototype/` | [mattpocock/skills](https://github.com/mattpocock/skills/tree/5863806dd4e15c63174bee4e7515a4256792ecfa/skills/engineering/prototype), `5863806dd4e15c63174bee4e7515a4256792ecfa` |

- Impeccable: одна точка входа; внутренние команды, например `$impeccable audit`, не отдельные skills. Не создавать дублирующие shortcuts без необходимости. `init` и `document` при установке не выполняются: продуктовый контекст уже хранится в Memory Bank.
- Impeccable runtime: официальный установщик создал `.codex/hooks.json`; для автоматических hooks требуется одобрение в Codex через `/hooks`. Engine проверен командой `scripts/impeccable engine-probe` → `impeccable-engine 0.1.24`; бинарник находится в `~/.impeccable/bin/0.1.24/`, в проекте сохраняются launcher и checksums. На другой машине первый запуск требует загрузки engine. CLI скачан через npx cache, зависимость приложения не добавлена. Установлены также лицензия и NOTICE.
- Animate: `RECIPES.md` и лицензия включены. `pick-ui-library` и `choreograph` включены как справочные документы в `references/` (с рецептами choreography), без дополнительных зарегистрированных skills. Локальная адаптация: ссылки на эти документы, снятие их skill frontmatter, ограничение стека ReelMe. Другие упомянутые автором skills для аудита/React Native не установлены.
- Optimize: включены `references/browser-profiling.md`, `agents/openai.yaml`, полный `demo/` и лицензия. Измерения требуют доступного браузерного инструмента и работающей страницы; установка не доказывает производительность приложения. В каталоге Codex отображается также как **Web Performance Audit**.
- Prototype: включены `UI.md`, `LOGIC.md`, `agents/openai.yaml` и лицензия. Примеры UI следуют существующему стеку; commit прототипа в отдельную ветку выполняется только при разрешении оператора.

Проверка установки: наличие frontmatter с именами, вспомогательных файлов и локальных ссылок; сверка исходных файлов с upstream и контроль сохранности прежних skills. Приложение и его зависимости в этой задаче не изменяются; дизайн, прототипирование и профилирование не запускаются.
