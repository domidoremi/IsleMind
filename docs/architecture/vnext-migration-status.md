# IsleMind vNext Migration Status

**Updated:** 2026-08-23

This is the short, current migration ledger. The architecture plan defines the target shape; `vnext-module-public-api.md` defines the allowed module entry points; this file records what is live, what is temporary, and when a temporary path may be deleted. Historical implementation detail belongs in Git history, not in this ledger.

## Current State

The product runtime is Chat-only. New business behavior belongs in `src/modules/<owner>/`, reusable technical effects in `src/platform/`, and concrete composition in `src/bootstrap/`. `src/services/` remains a compatibility boundary only; no new business logic should be added there.

`AssistantRun` schema v4 persists the exact captured handoff atomically with `run.created` as strictly validated durable evidence only; it does not grant recovery authority. Unsupported or incomplete rows are terminal decode-only no-replay inputs. Recovery does not infer effect authority unless an awaited durable final-output/success barrier exists.

`AssistantRunRequestSnapshot` schema v1 persists the final provider-neutral `ChatRequest` for the canonical ConversationRun path atomically with `run.created`. Rich Chat now prepares one immutable provider-neutral request before durable execution, dispatches that same request object after run creation, and atomically stores a separate redacted `AssistantRunActivityRequestSnapshot`. Credentials, cancellation objects, endpoint secrets, and binary bodies are excluded from Rich durable evidence. Rich text, citation, tool-call, usage, and bounded trace-lifecycle markers now use the existing `stream.event` journal and update the run checkpoint before terminal completion; raw trace content and metadata remain excluded. Assistant Runtime migration v7 adds an optional bounded `AssistantContextPlanReceipt` beside either snapshot; it records provider/model, token budget, compression, source manifest, and failure codes without raw context text. Migration v8 adds nullable capability revision and stable request-hash evidence to both snapshot forms; new rows bind those values to the exact canonical request or redacted Rich evidence, while legacy rows remain readable without invented identity. Full reset deletes the owning run rows and relies on foreign-key cascade for journals and both snapshot forms. These records are diagnostic-only; their versioned stable hash is not replay or authorization evidence, and full rich/plain planning parity remains open. Interrupted-run recovery carries any complete persisted request hash and capability revision into bounded `run.failed` evidence; recovery still never replays from that identity.

The normal Conversation send boundary now projects the exact user message once,
awaits that message's serialized SQLite mutation promise, and only then starts
provider/runtime dispatch. Reply-session startup applies the same barrier to the
assistant placeholder, so ordinary send, retry, and regenerate share one
pre-admission persistence owner. A rejected mutation prevents provider/runtime
effects and propagates to the caller; later queued mutations remain usable after
the rejected item. The Plain handoff then enqueues one compatibility save of the
Provider-admission-normalized conversation (provider, model, system prompt, and
generation parameters) before starting the plain runtime. That save is distinct
from the assistant-placeholder barrier and remains until one owner can persist
both records atomically.

Rich terminal durable output now comes from the finalization receipt rather than
from Zustand. A completed receipt supplies the durable final output, a skipped
receipt preserves the already journaled checkpoint accumulator, and checkpoint
writes are awaited before terminal completion. A terminal projection rejection
therefore fails the activity rather than fabricating a successful durable
output. Initial and nested provider-native/MCP revision streams now share the
same bounded normalized event bridge: continuation state is ordered before tool
calls, copied tool arguments and provider call metadata remain transient, and
the durable journal keeps its existing redaction. A post-finalization checkpoint
barrier prevents terminal success from overtaking nested revision events. This
improves bounded event parity. Nested Rich provider turns also write a bounded
started/completed continuation identity. Recovery pairs those markers and, when
one is left open, records the interrupted identity while terminalizing the run
with `resume: new-turn-only`; it never replays a provider request or tool effect.
The identity is diagnostic and recovery guidance, not replay authority. Focused
provider-family coverage now exercises the same bounded identity and recovery
semantics through OpenAI, Anthropic, and Google request shaping.

Conversation reads are now authoritative over normalized metadata and message
rows. Startup migration converts each valid legacy `payloadJson` record without
letting one malformed row block the remaining Chat database; ordinary list
hydration ignores invalid/unmigrated rows, while addressed reads and portable
recovery fail closed on record/state/message coverage drift. New and healthy
migrated databases remove the legacy payload column entirely. A malformed legacy
row keeps that column and its original bytes until the row is repaired or
removed and a later repository initialization can retry the lossless migration;
there is no runtime payload fallback or update mirror write (only a required
one-time payload on new inserts while that old non-null schema remains). Baseline Chat retrieval uses FTS;
RAPTOR, GraphRAG, ColBERT, hybrid indexes, and agentic retrieval require an
explicit deep plan rather than query complexity alone.

History hydration now reads a bounded normalized SQLite page (keyset ordered by
`updatedAt DESC, id ASC`) and appends later pages on demand. Search deliberately
drains the remaining pages so result completeness is unchanged; opening an
older active conversation uses an addressed full read. No separate pagination
cache, summary table, or generic paging framework was added.

## Supported Runtime And Data

| Surface | Current authority | Compatibility rule |
| --- | --- | --- |
| Conversations | Normalized SQLite conversation-state/message rows plus one `ACTIVE_CONVERSATION` record | Valid legacy payload rows migrate at startup and healthy/new schemas have no payload column; malformed rows stay isolated until a later lossless retry; reads never fall back to payload JSON |
| Chat runs | Chat `AssistantRun` rows, journals, exact canonical-request or redacted Rich-request snapshots, cancellation, and recovery | Non-Chat rows fail closed; migration v5 is an inert ledger tombstone; request evidence never grants replay authority |
| Composer drafts | Conversations-owned bounded draft port and `COMPOSER_DRAFTS` application record | Drafts expire, are capped, exclude attachments, and stay out of portable export |
| Workspaces | Native SQLite or browser v2 key-value envelope with Web Locks | Tavern v1 envelopes and key-value-to-SQLite migration paths are removed |
| Portable data | Data Management recovery plan composed by bootstrap | Import/restore is cancellation-aware, verifies committed state, and rolls back verified before-images |
| Credentials | Providers policy over Core/Platform secure storage | Reads, writes, deletes, rollback, and import verification remain fail-closed and redacted |
| Provider Settings | Providers-owned `createProviderSettingsList` bound in `src/bootstrap/providerSettingsList.ts` | Grouping, search, sorting, and model access filtering remain unchanged |

## Active Compatibility Layers

| Boundary | Owner/target | Deletion condition |
| --- | --- | --- |
| Rich provider callback entry and legacy stream adapter | Providers + bootstrap | One canonical request model, terminal receipt, and complete bounded event/recovery parity replace the redacted activity-evidence compatibility path across every rich tool/continuation flow |
| Plain handoff normalized-conversation compatibility save | Conversations + Assistant Runtime + bootstrap | One owner atomically persists the Provider-admission-normalized conversation and assistant placeholder, with equivalent ordering, failure fencing, and queue-recovery coverage |
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
- Conversation send and reply-session startup now await serialized SQLite persistence before provider/runtime admission; the Plain handoff's normalized-conversation compatibility save remains explicitly tracked above.
- Conversation payload mirrors are removed from new and healthy migrated schemas; malformed legacy rows retain original data until a later repository initialization can retry the migration.
- Removed media-tool manifests, duplicate Settings command identities, and consumer-free product handoff contracts remain restoration-gated.

## Next Bounded Work

1. Keep the shared frozen planning/receipt path aligned and use the persisted capability/request identity when comparing plain and Rich diagnostics.
2. Keep the Settings high-frequency path light. Low-frequency APK, notification, plugin, runtime-log, clipboard, and sharing implementations must remain deferred until their panel or action is used.
3. Replace remaining service imports only when a target owner, typed port, focused behavior test, and deletion condition exist together.
4. Treat debug-device memory and UIAutomator/gfx output as evidence with provenance. Release or profile builds are required before declaring a production memory budget.
5. Prefer executable types and behavior tests over new prose contracts. Update this ledger only when the runtime or deletion condition changes.

## Validation Contract

The smallest relevant gates are required for each slice:

- `bun run type-check`
- `node scripts/lazy-load-contract-tests.js`
- `bun run test:architecture-boundary`
- the owning module compatibility test and a focused real-device path when native behavior changes

Device evidence must name the device, build mode, Metro state, package/process, navigation path, and known instrumentation contamination. Screenshots and logs under `output/` are local evidence and may contain user data; review before publication.

## Deletion Rule

Delete a compatibility path only after its replacement is live, its persistence/permission/recovery semantics are covered by focused tests, and the architecture boundary gate proves that no caller or public export still depends on it. Do not restore removed names merely to satisfy stale assertions; update or delete the stale assertion with the owning migration slice.
