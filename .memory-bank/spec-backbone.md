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
- Границы уже заданной интеграции: локальная камера и клиентская страница; сервер ReelMe;
  внешний fal.ai; отправка почты. Это контекст, а не утверждённая модульная архитектура.
- Состояния: съёмка и передача; генерация и подготовка; получение по email; публичный
  показ; хранение мероприятия. Шесть публичных этапов не заменяют внутренние состояния.
- Доказательства интеграций: [fal API](analysis/fal-api.md); проверок камеры и реальных генераций пока нет.

## Open Design Questions
- Состояния фоновых заданий и восстановление обработки на принятом стеке.
- Удаление файлов на VPS и копий fal при сохранении общих материалов слота.
- Подключение выбранного SMTP.BZ и проверки из [AD-008](architecture/system-architecture.md#ad-008--отправка-писем-через-smtpbz).
- Механизм сессий двух аккаунтов и хранение ключа установки — [AD-009](architecture/system-architecture.md#ad-009--аккаунты-оператора-и-администратора-ключ-установки).
- Контракты и состояния на границах камеры, загрузки, fal и email; восстановление после перезапуска.
- От этих решений зависят технические спецификации и задачи реализации, а не уже принятые продуктовые требования.

## Backbone Area Matrix
| Area | Status | Authoritative source | Notes |
|---|---|---|---|
| requirements_and_scenarios | authoritative | [PRD](prd.md), [REQ](requirements.md) | Принятое поведение и функциональная приёмка |
| vocabulary | authoritative | [Glossary](glossary.md) | Один смысл для сессии, мероприятия, номера и подтверждений |
| deployment_constraints | authoritative | [Размещение](prd.md#принятая-схема-размещения) | Домен, VPS, локальный HTTP origin и оборудование |
| architecture_style | needed_before_tasks | [System Architecture](architecture/system-architecture.md) | Стек принят; внутренние границы и контракты ещё уточняются |
| domain_data_and_states | needed_before_tasks | [PRD](prd.md) | Владение данными, снимок параметров, номера, состояния и удаление |
| module_and_api_contracts | needed_before_tasks | [Boundary Map](contracts/boundary-map.md) | Модули и контракты пока не определены |
| runtime_and_operations | needed_before_tasks | [Архитектура](architecture/system-architecture.md) | Медиа на VPS, SMTP.BZ, два аккаунта и ключ установки приняты; нужны детали подключения, сессий, очистки и установки |
| verification | authoritative | [Функции](epics/EP-001-reelme-event.md) | План функциональных проверок; результатов выполнения пока нет |

## Handoff To /prd-to-features
- Ready: yes
- Результат: [EP-001](epics/EP-001-reelme-event.md) и пять функций с критериями приёмки.
- Изменения требований согласовываются в PRD и отражаются в связанных REQ/AC.

## Handoff To /spec-design
- Прочитать [PRD](prd.md), [Constitution](constitution.md), пять функций и [fal API](analysis/fal-api.md).
- Уточнить механизм принятой авторизации и подключение SMTP.BZ, затем состояния/данные, контракты, очистку и эксплуатацию.
- Foundation и границы задач пока не выбраны; их определит принятая архитектура.

## Global Backbone Status
- Status: blocked
- Planning Revision: 0
- Mode: pending
- Architecture artifact strategy: pending
- Причина: механизм сессий и хранение ключа установки ещё не определены; подключение SMTP.BZ, состояния и контракты требуют проработки.
