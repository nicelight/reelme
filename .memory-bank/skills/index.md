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
