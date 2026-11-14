---
description: Контекст декомпозиции и готовность архитектуры ReelMe.
status: active
---
# SDD Spec Backbone

## Pre-PRD Spec Status
- Status: ready_for_prd
- Основание: [PRD](prd.md), [словарь](glossary.md) и принятые решения интервью достаточны для декомпозиции.

## Decomposition Inputs
- Сценарии, роли, ограничения и исключения: [PRD](prd.md).
- Требования и покрытие: [REQ/RTM](requirements.md).
- Продуктовая декомпозиция: [EP-001](epics/EP-001-reelme-event.md), пять функций FT-001–FT-005.
- Сущности: слот/сюжет, материалы слота, мероприятие, фотосессия, запрос генерации,
  результат, отправка email. Значения — в [словаре](glossary.md).
- Фиксированные платформенные решения: Caddy, Svelte 5, TypeScript / Node.js / Fastify,
  SQLite и медиафайлы на диске VPS; детали — в [архитектуре](architecture/system-architecture.md).
- Принятые серверные модули — Access, Scenarios, Sessions; граф и внутренний контракт
  снимка слота — [Boundary Map](contracts/boundary-map.md).
- Состояния: съёмка и передача; генерация и подготовка; получение по email; публичный
  показ; хранение мероприятия. Шесть публичных этапов не заменяют внутренние состояния.
- Дата, номер и снимок слота закрепляются при начале съёмки; данные — [модель](domains/core-domain.md),
  по обработке/выдаче/очистке — [жизненный цикл](states/lifecycle-map.md).
- Доказательства интеграций: [fal API](analysis/fal-api.md); проверок камеры и реальных генераций пока нет.

## Open Design Questions
- Архитектурных вопросов, блокирующих постановку задач, нет.
- Конкретный VPS, credentials fal/SMTP и адрес отправителя задаются при подключении.
- Камера недоступна во время разработки. Аппаратная приёмка FT-002 — TASK-005
  после завершения разработки приложения; до неё используются тестовые ответы digiCamControl.
- Работа Canon, фактические ограничения вложений/брендинг SMTP.BZ и реальные генерации
  проверяются в задачах; эти испытания пока не выполнены.

## Backbone Area Matrix
| Area | Status | Authoritative source | Notes |
|---|---|---|---|
| requirements_and_scenarios | authoritative | [PRD](prd.md), [REQ](requirements.md) | Принятое поведение и функциональная приёмка |
| vocabulary | authoritative | [Glossary](glossary.md) | Один смысл для сессии, мероприятия, номера и подтверждений |
| deployment_constraints | authoritative | [Размещение](prd.md#принятая-схема-размещения) | Домен, VPS, локальный HTTP origin и оборудование |
| architecture_style | authoritative | [System Architecture](architecture/system-architecture.md) | Приняты три серверных модуля и отсутствие отдельной Foundation |
| domain_data_and_states | authoritative | [Данные](domains/core-domain.md), [состояния](states/lifecycle-map.md) | Основной путь и владение файлами определены |
| module_and_api_contracts | authoritative | [Boundary Map](contracts/boundary-map.md), [HTTP](contracts/http-api.md) | HTTP и [внешние интеграции](contracts/integrations.md) достаточны для задач |
| runtime_and_operations | authoritative | [Архитектура](architecture/system-architecture.md) | Один процесс/systemd, Caddy, SQLite/файлы, SMTP, роли и установка определены |
| verification | authoritative | [Функции](epics/EP-001-reelme-event.md) | План функциональных проверок; результатов выполнения пока нет |

## Handoff To /prd-to-features
- Ready: yes
- Результат: [EP-001](epics/EP-001-reelme-event.md) и пять функций с критериями приёмки.
- Изменения требований согласовываются в PRD и отражаются в связанных REQ/AC.

## Handoff To /feature-to-tasks
- /spec-design завершён в минимально достаточном объёме; пять функций имеют ссылки на спецификации.
- FT-001–FT-005 разложены в [индексированные задачи](tasks/index.json); их состояние и доказательства хранятся в карточках.
- Следующий шаг — [TASK-001](tasks/TASK-001-T3-FT-001-W1.task.json): начальная настройка и сохранение сюжета.
  Первый генерационный путь — Recast в [TASK-006](tasks/TASK-006-T3-FT-003-W4.task.json).
- [Отдельный Foundation не нужен](foundation.md); сборка/запуск входят в первую сквозную задачу.
- Проверки основного пути и подтверждённых интеграционных ограничений включаются в задачи,
  без дополнительных механизмов и проверочных матриц для гипотетических сбоев.

## Global Backbone Status
- Status: minimal
- Planning Revision: 1
- Mode: local_simple_backbone
- Architecture artifact strategy: split-by-boundary-topic
- Основание: минимальная архитектура, данные, состояния, доступ и внешние интеграции определены.
