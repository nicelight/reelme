---
description: Minimal framework baseline policy for risk-based testing and verification evidence.
status: active
---
# Testing Strategy

## Risk-based checks
- Choose checks from concrete product and regression risks in the PRD,
  Constitution, requirements, features, subject specs, and actual project shape.
- Use the cheapest check that reliably proves the required behavior.
- Add a broader or more expensive test level only when a narrower check cannot
  prove the outcome.
- Do not create tests merely to fill unit, integration, or e2e categories.

## Integrity
- Do not weaken assertions, disable failing checks, or replace meaningful
  verification with decorative coverage to obtain a green result.
- Treat a failing applicable check as evidence to investigate or resolve within
  explicit scope.

## Alembic migration ownership
- For an accepted linear Alembic graph, one project-level database contract
  owns dynamic checks for a single head, no branches, and intact ancestry.
  A feature migration test owns only its revision, direct `down_revision`,
  upgrade/downgrade, schema transition, and data preservation.
- A new revision reruns the project-level contract; it does not require literal
  current-head consumers or historical feature-test updates. Resolve current
  head at execution preflight when needed and keep its ID out of durable testing
  specs, feature plans, and task cards.

## Evidence and ownership
- Select verification depth under `.memory-bank/workflows/execute-loop.md#working-policy`; tier is guidance, not a prescribed test method.
- Record actual results and any skipped/unavailable checks in task `verify`. Use
  `.protocols/<TASK_ID>/` or `.tasks/<TASK_ID>/` for useful supporting evidence.
  Missing separate protocols or review reports do not invalidate a result.
- Keep product quality targets in requirements/features and simple verification
  methods in feature AC/task records. Use a subject spec only for a non-trivial
  reproducible measurement method or expert rubric; it never supplies a missing
  product target. Keep executable gates in task records.
