# IsleMind vNext Migration Status

**Updated:** 2026-08-17

This is the short, current migration ledger. The architecture plan defines the target shape; `vnext-module-public-api.md` defines the allowed module entry points; this file records what is live, what is temporary, and when a temporary path may be deleted. Historical implementation detail belongs in Git history, not in this ledger.

## Current State

The product runtime is Chat-only. New business behavior belongs in `src/modules/<owner>/`, reusable technical effects in `src/platform/`, and concrete composition in `src/bootstrap/`. `src/services/` remains a compatibility boundary only; no new business logic should be added there.

`AssistantRun` schema v4 persists the exact captured handoff atomically with `run.created` as strictly validated durable evidence only; it does not grant recovery authority. Unsupported or incomplete rows are terminal decode-only no-replay inputs. Recovery does not infer effect authority unless an awaited durable final-output/success barrier exists.

## Supported Runtime And Data

| Surface | Current authority | Compatibility rule |
| --- | --- | --- |
| Conversations | Current SQLite rows plus one `ACTIVE_CONVERSATION` record | Removed `CONVERSATIONS` cache, mode-keyed selection, old writers, and product-mode fields are not read |
| Chat runs | Chat `AssistantRun` rows, journals, cancellation, and recovery | Non-Chat rows fail closed; migration v5 is an inert ledger tombstone |
| Composer drafts | Conversations-owned bounded draft port and `COMPOSER_DRAFTS` application record | Drafts expire, are capped, exclude attachments, and stay out of portable export |
| Workspaces | Native SQLite or browser v2 key-value envelope with Web Locks | Tavern v1 envelopes and key-value-to-SQLite migration paths are removed |
| Portable data | Data Management recovery plan composed by bootstrap | Import/restore is cancellation-aware, verifies committed state, and rolls back verified before-images |
| Credentials | Providers policy over Core/Platform secure storage | Reads, writes, deletes, rollback, and import verification remain fail-closed and redacted |
| Provider Settings | Providers-owned `createProviderSettingsList` bound in `src/bootstrap/providerSettingsList.ts` | Grouping, search, sorting, and model access filtering remain unchanged |

## Active Compatibility Layers

| Boundary | Owner/target | Deletion condition |
| --- | --- | --- |
| Rich provider callback entry and legacy stream adapter | Providers + bootstrap | Canonical `ChatRequest`/`StreamEvent` request and terminal-receipt parity across rich tool/continuation flows |
| `src/services/runtimeDiagnostics.ts` event normalization | Diagnostics | All production consumers use the Diagnostics public API and a platform sink is composed |
| `src/services/appUpdates.ts` and `runtimeLog.ts` | Platform Native | Typed native ports are composed in bootstrap and focused Android/release evidence covers errors, cancellation, and permission states |
| `src/services/pluginManifest.ts` | Integrations | Catalog projection and persistence move behind an Integrations-owned port with equivalent review and capability checks |
| External-agent runtime descriptors | Integrations | A concrete launcher, process ownership, resume persistence, and signal evidence exist; descriptors alone do not advertise execution |
| Historical Agent/Companion/Tavern names in durable records and tests | Owning migration module | Exact schema migration and compatibility evidence prove the names are no longer needed as data or drift markers |
| Structured model-operation fallback and native declarations | Assistant Runtime + Integrations | One canonical operation protocol has complete provider-family parity and replay/cancellation coverage |

These layers are compatibility boundaries, not invitations to add new callers. Each new consumer must use the target module API or a bootstrap binding.

## Completed Removals

- Legacy storage facades, old multi-key state, portable recovery blobs, conversation caches, and product-mode persistence/selectors are deleted.
- Agent/Companion product routes and alternate runtime branches are deleted; legacy intents normalize into Chat only.
- Tavern v1 envelopes and key-value-to-SQLite migration readers are deleted; current native SQLite and browser v2 storage remain.
- Provider Settings list and observability compatibility evaluators moved into owner-private module/testing surfaces; the old service paths are deleted.
- Android status notification permission, update, clear, and settings effects are Platform Native-owned, bootstrap-composed, and injected into task-bound Android tools; the legacy service facade is deleted.
- Removed media-tool manifests, duplicate Settings command identities, and consumer-free product handoff contracts remain restoration-gated.

## Next Bounded Work

1. Keep the Settings high-frequency path light. Low-frequency APK, notification, plugin, runtime-log, clipboard, and sharing implementations must remain deferred until their panel or action is used.
2. Replace remaining service imports only when a target owner, typed port, focused behavior test, and deletion condition exist together.
3. Treat debug-device memory and UIAutomator/gfx output as evidence with provenance. Release or profile builds are required before declaring a production memory budget.
4. Prefer executable types and behavior tests over new prose contracts. Update this ledger only when the runtime or deletion condition changes.

## Validation Contract

The smallest relevant gates are required for each slice:

- `bun run type-check`
- `node scripts/lazy-load-contract-tests.js`
- `bun run test:architecture-boundary`
- the owning module compatibility test and a focused real-device path when native behavior changes

Device evidence must name the device, build mode, Metro state, package/process, navigation path, and known instrumentation contamination. Screenshots and logs under `output/` are local evidence and may contain user data; review before publication.

## Deletion Rule

Delete a compatibility path only after its replacement is live, its persistence/permission/recovery semantics are covered by focused tests, and the architecture boundary gate proves that no caller or public export still depends on it. Do not restore removed names merely to satisfy stale assertions; update or delete the stale assertion with the owning migration slice.
