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
- Фиксированные платформенные решения: Caddy на входе VPS, Svelte 5 для интерфейсов.
- Границы уже заданной интеграции: локальная камера и клиентская страница; сервер ReelMe;
  внешний fal.ai; отправка почты. Это контекст, а не утверждённая модульная архитектура.
- Состояния: съёмка и передача; генерация и подготовка; получение по email; публичный
  показ; хранение мероприятия. Шесть публичных этапов не заменяют внутренние состояния.
- Доказательства интеграций: [fal API](analysis/fal-api.md); проверок камеры и реальных генераций пока нет.

## Open Design Questions
- Серверный стек, постоянное хранение и фоновые задания для VPS AlmaLinux / 4 ГБ RAM.
- Размещение медиа и удаление собственных файлов/копий fal при сохранении общих материалов слота.
- Почтовая отправка, её лимиты и авторизация админки/локальной установки.
- Контракты и состояния на границах камеры, загрузки, fal и email; восстановление после перезапуска.
- От этих решений зависят технические спецификации и задачи реализации, а не уже принятые продуктовые требования.

## Backbone Area Matrix
| Area | Status | Authoritative source | Notes |
|---|---|---|---|
| requirements_and_scenarios | authoritative | [PRD](prd.md), [REQ](requirements.md) | Принятое поведение и функциональная приёмка |
| vocabulary | authoritative | [Glossary](glossary.md) | Один смысл для сессии, мероприятия, номера и подтверждений |
| deployment_constraints | authoritative | [Размещение](prd.md#принятая-схема-размещения) | Домен, VPS, локальный HTTP origin и оборудование |
| architecture_style | blocked | [System Architecture](architecture/system-architecture.md) | Нужно обсудить серверную схему и стек |
| domain_data_and_states | needed_before_tasks | [PRD](prd.md) | Владение данными, снимок параметров, номера, состояния и удаление |
| module_and_api_contracts | needed_before_tasks | [Boundary Map](contracts/boundary-map.md) | Модули и контракты пока не определены |
| runtime_and_operations | blocked | [Размещение](prd.md#принятая-схема-размещения) | Хранение, обработчик, почта, авторизация и установка |
| verification | authoritative | [Функции](epics/EP-001-reelme-event.md) | План функциональных проверок; результатов выполнения пока нет |

## Handoff To /prd-to-features
- Ready: yes
- Результат: [EP-001](epics/EP-001-reelme-event.md) и пять функций с критериями приёмки.
- Изменения требований согласовываются в PRD и отражаются в связанных REQ/AC.

## Handoff To /spec-design
- Прочитать [PRD](prd.md), [Constitution](constitution.md), пять функций и [fal API](analysis/fal-api.md).
- Обсудить серверную схему, затем определить состояния/данные, контракты, хранение и эксплуатацию.
- Foundation и границы задач пока не выбраны; их определит принятая архитектура.

## Global Backbone Status
- Status: blocked
- Planning Revision: 0
- Mode: pending
- Architecture artifact strategy: pending
- Причина: существенные решения о серверном стеке, хранении, фоновой обработке и почте ещё не приняты.
