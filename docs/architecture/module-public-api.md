# Module Public API Manifest

This document defines the allowed cross-module entry points. The executable symbol list is each owner's `src/modules/<owner>/index.ts`; duplicating every exported symbol here caused drift and is intentionally avoided.

Consumers import only `@/modules/<owner>`. A module's `domain/`, `application/`, `ports/`, `adapters/`, and `testing/` folders are private. `bootstrap/` may bind concrete adapters but still consumes module entry points rather than deep imports.

## Public Entry Points

| Entry point | Owner | Public responsibility |
| --- | --- | --- |
| `@/modules/assistant-runtime` | Assistant Runtime | Chat run lifecycle, streaming, journals, cancellation, context orchestration, and recovery |
| `@/modules/conversations` | Conversations | Conversation/message lifecycle, Chat reply entry, drafts, and persistence contracts |
| `@/modules/data-management` | Data Management | Portable export/import/reset plans and recovery participants |
| `@/modules/diagnostics` | Diagnostics | Redacted runtime events, sink policy, bounded previews, and diagnostic projections |
| `@/modules/integrations` | Integrations | MCP, built-in, Android, web, and model-operation contracts |
| `@/modules/knowledge` | Knowledge | Documents, retrieval, memory, RAG, citations, and knowledge persistence contracts |
| `@/modules/providers` | Providers | Provider identity, credentials policy, routing, request shaping, streaming, health, usage, and model access |
| `@/modules/settings` | Settings | Settings persistence and configuration use cases |
| `@/modules/tasks` | Tasks | Chat workflow state, permission decisions, confirmations, artifacts, checkpoints, and task journals |
| `@/modules/workspaces` | Workspaces | Chat workspace authority, review/writeback, persistence, and portable workspace recovery |

## Current Product Contract

- Chat is the only product and execution entry. Removed Agent/Companion product-mode selectors, persisted metadata, decoders, routes, and labels are not public APIs.
- Workspaces retains current Chat workspace data and recovery behavior. Tavern is the active role-play workspace domain, not an alternate product mode.
- Provider Settings list grouping/search/filter/sort is created by `@/modules/providers` and bound in `src/bootstrap/providerSettingsList.ts`.
- Settings and Provider metadata persistence are owner-defined ports bound by bootstrap to current application records.
- Frozen compatibility evaluators live under each owner's `testing/` folder and are never exported by a module entry point.
- Presentation can consume module entries and presentation helpers. It must not instantiate concrete storage, HTTP, SQLite, Expo, or Android adapters.

## Durable Recovery Boundary

`AssistantRun` schema v4 persists the exact captured handoff atomically with `run.created` as strictly validated durable evidence only; it does not grant recovery authority. Rich and Plain Chat both store the final canonical `ChatRequest` snapshot with a versioned capability revision, stable request hash, and bounded context receipt. Legacy redacted activity-request snapshots remain readable for historical rows, but no current runtime or public input can write one. Rich text, citation, tool-call, usage, and bounded trace-lifecycle markers are additionally journaled as `stream.event` checkpoints before terminal completion; trace content and metadata are excluded. Nested Rich provider turns add bounded started/completed continuation markers; an unmatched marker is surfaced during restart recovery as an interrupted identity with `resume: new-turn-only`, and recovery never replays a provider request or tool effect. Unsupported or incomplete rows are terminal decode-only no-replay inputs. Recovery does not infer effect authority unless an awaited durable final-output/success barrier exists.

Current readers support current Chat rows and current storage formats. Owner-private decoders may read a bounded historical shape or storage key only when focused tests prove lossless migration into the current authority; removed writers, alternate runtime branches, multi-key storage, conversation caches, and the old AsyncStorage recovery-blob path are not public compatibility requirements.

## Model Operation Boundary

- Integrations owns the immutable catalog, normalized calls, bounded receipts, schema validation, and runnable-capability admission.
- Assistant Runtime owns the bounded operation loop, pending confirmation state, continuation, cancellation, and recovery.
- Tasks owns durable authorization, permission decisions, confirmation, and idempotency.
- Bootstrap binds concrete executors and freezes the catalog revision used by a run.
- A manifest or catalog entry does not prove that a capability is runnable; a concrete admitted port is required.

## Rules

1. Add an export to the owner's `index.ts` only when another module has a real consumer.
2. Import another module only through `@/modules/<owner>`; deep imports fail the architecture gate.
3. Keep concrete adapter construction in `bootstrap/` and reusable technical effects in `platform/`.
4. Keep domain/application code free of React, Expo, Zustand, HTTP, SQLite, and concrete adapters.
5. A compatibility layer must have an owner, replacement, focused test, and deletion condition next to its implementation.
6. Do not add prose-only contracts when executable types and behavior tests already define the rule.
