---
description: Pure SDD spec registry and planned-spec index.
status: active
last_updated: 2026-11-14
source_of_truth:
  - .memory-bank/spec-index.md
---
# SDD Spec Index

## Purpose
- Keep a concise registry of existing and planned SDD specs.
- Read this index before creating new specs or doing serious design-pressure work.
- Keep readiness, open design questions, backbone status, and routing handoffs in [.memory-bank/spec-backbone.md](spec-backbone.md).
- Feature `spec_design_status` lives in feature frontmatter, not in this index.
- `/spec-design` routes below mean initial backbone creation; accepted
  backbone/shared-contract changes use `/spec-redesign`.

## Spec Registry
| Type | Path | Status | Scope | Change route |
|---|---|---|---|---|
| governance | [.memory-bank/constitution.md](constitution.md) | active | Top governing policy. | /constitution |
| architecture | [.memory-bank/architecture/system-architecture.md](architecture/system-architecture.md) | active | Серверная основа, модули и развёртывание ReelMe. | /spec-design; затем /spec-redesign |
| data | [.memory-bank/domains/core-domain.md](domains/core-domain.md) | active | Идентичность сессии, снимок слота, файлы, даты и номера. | /spec-design |
| lifecycle | [.memory-bank/states/lifecycle-map.md](states/lifecycle-map.md) | active | Обработка, выдача, восстановление и удаление. | /spec-design |
| invariants | [.memory-bank/invariants.md](invariants.md) | planned | Global MUST/NEVER rules when evidence exists. | /spec-init or initial /spec-design; post-acceptance /spec-redesign |
| glossary | [.memory-bank/glossary.md](glossary.md) | active | Термины ReelMe: слот, фотосессия, мероприятие, номер, подтверждения. | /spec-init or initial /spec-design; post-acceptance /spec-redesign |
| contract | [.memory-bank/contracts/boundary-map.md](contracts/boundary-map.md) | active | Canonical accepted module/change-unit dependency graph and boundary contracts. | initial /spec-design, post-acceptance /spec-redesign, or /feature-to-tasks |
| contract | [.memory-bank/contracts/http-api.md](contracts/http-api.md) | active | Каталог, съёмка, экран, архив и выдача; payloads, ошибки и повторы. | /spec-design |
| contract | [.memory-bank/contracts/access.md](contracts/access.md) | active | Права, сроки входа, ключ установки и ссылки посетителя. | /spec-design |
| contract | [.memory-bank/contracts/integrations.md](contracts/integrations.md) | active | Камера, SMTP, очередь fal и хранение медиа. | /spec-design |
| foundation | [.memory-bank/foundation.md](foundation.md) | active | Принятое отсутствие отдельной Foundation-очереди. | /spec-design |
| testing | [.memory-bank/testing/strategy.md](testing/strategy.md) | active | Framework baseline testing policy. | explicit project-level user decision |

## Planned Specs
| Area | Expected path | Needed by | Notes |
|---|---|---|---|
| user_scenarios | .memory-bank/user-scenarios.md | /prd-to-features, /spec-design | Create only when scenario evidence exists or gaps must be explicit. |
| module_dependency_graph | .memory-bank/contracts/boundary-map.md | /spec-design, /feature-to-tasks | Establish accepted architecture units first, then register concrete modules, allowed dependency edges, and exact contract blocks before task handoff. |
| system_architecture | .memory-bank/architecture/system-architecture.md | /spec-design | Candidate architecture hub; fill only when selected or needed by /spec-design. |
| interface_contract_specs | .memory-bank/contracts/*, .memory-bank/testing/*, and .memory-bank/runbooks/* | /spec-design, /foundation-to-tasks, /feature-to-tasks | Generate/update Interface Specification and only applicable Component/API/Event/Data contracts, protocol/agent/tool I/O, boundary compatibility, evidence/redaction, safety/security, testing, runbook, or verification contracts. Data Contract defines payloads crossing a boundary. |
| data_specs | .memory-bank/domains/* and .memory-bank/states/* | /spec-design, /feature-to-tasks | Generate/update Data Specification for internal models, DB schemas, storage/persistence/migrations, internal data formats, validation/serialization rules, lifecycle, retention, seed, or runtime data paths. |
| foundation_substrate_specs | .memory-bank/architecture/*, .memory-bank/contracts/*, .memory-bank/domains/*, .memory-bank/states/*, .memory-bank/testing/*, .memory-bank/runbooks/* | /foundation-to-tasks | Apply Architecture, Interfaces/Contracts, and Data lenses to the walking-skeleton proof path. Generate only applicable subject-based substrate contracts/specs. Product-level detail reuses or extends those paths later. |
| subject_feature_concerns | .memory-bank/contracts/*, .memory-bank/domains/*, .memory-bank/states/*, .memory-bank/testing/*, .memory-bank/runbooks/*, or .memory-bank/guides/* | /feature-to-tasks | Discover existing canonical specs first; create only missing subject-based concerns and link exact paths from features/tasks. |

## Broken / Missing Links
- TBD

## Update Rules
- Keep this file as index/registry only: types, canonical paths, statuses,
  scopes, change routes, and broken links.
- Canonical identity is the path. Do not add a separate spec key, feature owner,
  `used_by`, or reverse-usage copy; derive usage from feature/task links.
- Do not add global backbone status, backbone matrices, feature status maps, long hard rules, or open design question dumps here.
- Use [.memory-bank/spec-backbone.md](spec-backbone.md) for pre-PRD readiness, decomposition inputs, global backbone status, matrix, and handoffs.
- Use linked specs or ADRs for detailed decisions, rationale, contracts, state transitions, schemas, invariants, and testing rules.
