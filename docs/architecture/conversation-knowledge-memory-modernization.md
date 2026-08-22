# Conversation, Knowledge, and Memory Modernization

**Status:** Architecture decision approved on 2026-08-20; incremental
implementation is authorized under the migration and deletion gates below.

**Reviewed:** 2026-08-20

**Scope:** Chat conversations, context planning, knowledge retrieval, long-term
memory, provider capability binding, persistence, and their Settings surfaces.

This document extends the vNext architecture plan. It does not replace the
module ownership, public API, trust, cancellation, or recovery rules in
`islemind-vnext-architecture-refactor-plan.md`.

The existing recovery boundary remains binding during this modernization:
`AssistantRun` schema v4 persists the exact captured handoff atomically with `run.created` as strictly validated durable evidence only; it does not grant recovery authority.
Unsupported or incomplete rows are terminal decode-only no-replay inputs, and
recovery does not infer effect authority unless an awaited durable final-output/success barrier exists.

## Executive Summary

The current system is functional but not one coherent Conversation/Context
architecture. Its largest risks are: (1) plain, rich, and Tasks lanes with
different request and durability semantics; (2) optimistic Zustand state and
whole-conversation JSON competing with durable Assistant Run state; (3) two
budgets and several retrieval/index/rerank implementations; (4) incomplete
provider/tool continuation and stream-event parity; (5) Memory/Knowledge and
legacy/vNext models drifting at their boundaries; and (6) a settings surface
that exposes implementation internals. The recommended direction is deletion
and consolidation: one ordinary Chat planning/runtime path, SQLite/FTS5 as the
offline authority, structured Knowledge-owned Memory, one budget-driven frozen
plan, and the existing model-operation protocol for tool continuations.

## Executive Decision

This decision is approved for incremental implementation. IsleMind should have
one provider-neutral context pipeline for every eligible Chat turn.
The target is deliberately smaller than the current RAG stack:

1. SQLite is the local source of truth.
2. FTS5 is the reliable default retriever.
3. Semantic retrieval is optional and is enabled only when an embedding model
   with a verified identity is available.
4. Memory is structured user knowledge with evidence and supersession, not a
   second collection of unversioned text snippets.
5. History, memory, knowledge, attachments, and tool results share one context
   budget and one final packing pass.
6. The exact provider-neutral request is persisted before dispatch so a run can
   explain what the model actually received; this is already true for canonical
   Chat, while Rich activity remains redacted diagnostic evidence until cutover.
7. The default UI exposes Provider, Model, Knowledge, and Memory. Retrieval
   internals live behind three presets and a genuinely advanced screen.

The immediate goal is not to add another framework. It is to remove divergent
execution paths, misleading capability names, duplicate budgets, and indexes
whose quality cannot be demonstrated.

## Evidence And Limits

The review used current source, current vNext architecture documents,
GitNexus impact data, focused executable tests, Android and Expo documentation,
and primary open-source project material. It did not establish release-device
latency, battery, memory, or retrieval-quality budgets. Those require named
Android devices and a project-specific gold set.

Focused baseline checks completed during the review (these validate current
contracts, not the target architecture):

- `bun run test:vnext-walking-skeleton`
- `bun run test:context-compression-v2`
- `bun run test:memory-governance`
- `bun run test:context-engineering-compatibility`
- `bun run test:rag-retrieval-eval`
- `bun run test:vnext-architecture-contract`
- `bun run type-check`
- `bun run test:architecture-boundary`
- `bun run test:vnext-task-runtime`
- `bun run test:local-inference-compatibility`

Passing source and unit gates does not prove provider, crash-recovery, native
SQLite extension, or real-device behavior.

GitNexus `detect_changes(scope=all)` sees the pre-existing dirty worktree as
94 changed files, 525 changed symbols, 111 affected symbols, and CRITICAL
aggregate risk. That result is a baseline warning for any future commit, not a
claim that this documentation-only audit changed those symbols.

## 1. Current Architecture Problems

### 1.1 The composition root has become behavior-heavy

`src/bootstrap/` contains roughly 138 files and 18,900 lines. Composition is
split across many narrowly named runtimes. This makes the actual Chat request
flow difficult to trace and permits behavior to differ based on which bootstrap
entry happens to be selected.

The intended vNext rule remains correct: modules own behavior and bootstrap
binds concrete effects. The remedy is not another registry. The remedy is one
Assistant Runtime turn entry that accepts already bound capabilities.

### 1.2 The same Chat product has two request semantics

The current reply flow selects a plain or rich handoff. Both paths now perform
some context acquisition and planning, but they use different request shapes,
provider gateways, stream protocols, continuation logic, snapshots, and
recovery semantics. Plain eligibility is deliberately narrow: attachments,
search, skills, and tools select the rich path. Explicit workflow/work-artifact
turns are a separate Tasks lane. Optional Chat capabilities therefore still
change history selection, token cost, diagnostics, and recovery behavior inside
the same product.

The target invariant is that optional Chat capabilities enrich one Chat runtime
instead of selecting a different request/stream state machine. The Tasks lane
remains intentionally separate.

### 1.3 Durable execution is not uniform

The canonical Assistant Runtime owns the run and journal. Rich streaming still
uses a Zustand projection for the immediate UI and a transitional callback
gateway. Text, citation, tool-call, usage, and bounded trace-lifecycle events
are projected into diagnostic `stream.event` entries, but rich citations,
tool calls, and usage can be synthesized at callback completion; tool
arguments/provider metadata and terminal/error/tool-result lifecycle events are
not durable. Trace content and metadata stay out of durable evidence; capability
identity and full replay parity remain separate migration work, so a crash can
retain diagnostic progress without making the Rich activity a replay authority.

### 1.4 Conversation persistence is normalized and pageable

`sqliteConversationRepository.ts` now stores metadata and individually
addressable messages in normalized SQLite rows, and authoritative reads no
longer fall back to `payloadJson`. Valid legacy rows migrate at repository
startup while malformed rows remain isolated and strict recovery detects
record/state/message drift. New databases and healthy legacy databases now
remove the payload column through an in-transaction table rebuild. If a legacy
row is malformed, the original column and bytes remain until that row is
repaired or removed and a later repository initialization retries the migration;
runtime reads never use the payload as a fallback. While that old non-null
schema remains, only a required new-record insert may populate the legacy
column; updates never rewrite it.

### 1.5 Complexity is concentrated in names, files, and switches

The Knowledge module is roughly 44 files and 11,600 lines and Assistant Runtime
is roughly 34 files and 14,000 lines. File count is not itself a defect, but the
current stack duplicates retrieval, packing, evaluation, cache, compatibility,
and diagnostic representations while exposing many of them as product choices.

## 2. Conversation, Knowledge, And Memory Problems

### Boundary definitions for the target

- **Conversation** is the durable ordered record of a user's chat messages,
  assistant outputs, conversation metadata, and summary checkpoints. It does
  not own retrieval algorithms, provider serialization, credentials, tool
  authorization, raw stream buffers, or UI lifecycle.
- **Knowledge** is imported, user-selected or app-owned source material and
  its chunks, provenance, indexing state, retrieval candidates, and citations.
  It does not store the live transcript, provider request, or transient tool
  execution state.
- **Memory** is a Knowledge-owned, scoped set of user/conversation facts with
  evidence, confidence, validity, review status, and supersession/conflict
  links. It is not a transcript summary by default, not every conversation
  sentence, and not an autonomous hidden profile. Conversation summaries remain
  Conversation-owned; episodic history remains searchable Conversation data.
- **Context** is a per-run assembly result, never a durable source entity. It
  selects and budgets Conversation, Memory, Knowledge, attachment, and admitted
  tool contributions, then freezes the provider-neutral request and manifest.

### 2.1 Conversation

- Plain and rich turns do not share one frozen context plan.
- Whole-conversation JSON prevents incremental reads, writes, and pagination.
- User and assistant messages are projected before their asynchronous
  conversation write is known durable; the plain compatibility handoff has a
  second, direct repository-write ordering authority.
- `Message` combines durable content with streaming status, traces, usage,
  provider errors, timing, citations, and UI-facing response fields.
- Application-level summarization can replace the active prompt after the
  original manifest/window was calculated, so diagnostics can describe a plan
  that was not dispatched.
- Long history policy is coupled to request-path selection instead of model
  capability and a single budget.
- The Knowledge context snapshot and Assistant Runtime ID snapshot do not by
  themselves reproduce the final request. Canonical request snapshots do;
  Rich activity snapshots remain redacted and non-replayable.

### 2.2 Knowledge

- `runAgenticRag` is a high-impact hub with four direct callers, ten upstream
  symbols, and three affected modules. Rewriting it in place would create a
  large regression surface.
- Retrieval defaults enable Query Rewrite, HyDE, FLARE, graph, RAPTOR,
  cross-encoder, ColBERT, and LLMLingua-like paths together.
- Several names describe approximations rather than the named model or method:
  hash vectors, token overlap, regex entities, extractive sentence selection,
  and deterministic local heuristics.
- Scope filtering occurs after some global candidate limits, and vector search
  scans a bounded recent subset. Relevant scoped or older chunks can be omitted
  before ranking.
- FTS5 BM25 score direction is not treated consistently across adapters; the
  current normalization can reward weaker lexical matches after fusion/rerank.
- The canonical chunk schema records `embeddingProvider` and
  `embeddingModelId`, but the derived `chunk_embeddings` identity is still
  effectively one mutable row per chunk. Dimension/normalization/revision are
  not a complete uniqueness boundary, so incompatible vectors can be compared
  or overwritten during upgrades.
- Large imports can synchronously chunk and index up to 20 MiB. PDF extraction
  can place a whole Base64 document in JS memory before model extraction.
- A saved content hash is not currently an effective duplicate-import key.
- Canonical Knowledge, RAG replay, and evaluation storage have independent
  lifecycles; the two v3 Knowledge migrations appear to reuse one migration
  ledger key and require device-database verification.
- FTS is globally limited before scope filtering, and the semantic path scans a
  bounded recent subset in JavaScript rather than a true vector index.

### 2.3 Memory

- Deterministic extraction is already available without a generation-provider
  key. The remaining problem is lifecycle policy, not an absolute credential
  dependency.
- Structured fields (`scope`, `subject`, `factKey`, `factValue`, validity,
  evidence IDs, supersession/conflict IDs), activation-time supersession, and a
  partial unique index for active logical keys already exist. Normal extraction
  still begins as pending candidates and its content-level pre-scan can bypass
  that logical-key policy for unstructured or concurrent writes.
- Candidate persistence performs an O(N) `listAll()` plus normalized-content
  deduplication. Active structured facts have a database uniqueness rule, but
  pending/unstructured content and concurrent candidate writes need a focused
  contract.
- Content deduplication includes disabled/superseded rows, so old text can block
  a legitimate re-extraction. FTS5 BM25 values are negative and score direction
  is normalized inconsistently across memory/chunk adapters; this needs one
  explicit ordering contract and test.
- The current code has recency scoring but no automatic inactivity disablement;
  expiration must be explicit through `validUntil` or a user decision.
- Memory and knowledge are still collapsed into a generic `retrieved_context`
  contribution before final prompt packing, so authority and budgets are not
  independently visible at the final request boundary.
- Legacy `src/types/contextContracts.ts` still defines parallel Memory,
  Document, Chunk, and Retrieval models beside the Knowledge-owned durable
  records, creating mapper and status drift.

## 3. Current Context-Building Problems

The current flow has five correctness problems:

1. **Path divergence:** optional capabilities select plain or rich planning and
   two provider/stream protocols; explicit workflow turns are a separate lane.
2. **Noisy retrieval intent:** the retrieval query currently uses user text and
   conversation title; the system prompt is intentionally excluded, but title
   noise and prompt-derived planning metadata still need privacy/recall review.
3. **Double budgeting:** RAG packs against its own approximate token budget and
   Assistant Runtime truncates again against the provider window. The second
   cut can separate evidence from citations.
4. **Mixed provenance:** `ContextSnapshot` primarily preserves IDs and rendered
   context, while canonical `AssistantRunRequestSnapshot` stores the final
   `ChatRequest`. Rich Chat stores redacted activity evidence, not a byte-exact
   replay request; the two forms are not equivalent.
5. **Plan drift:** application summary output can replace the prompt without
   rebuilding the complete manifest and budget report.

### 3.1 Provider and streaming boundary

Two live provider protocols remain. Canonical Assistant Runtime consumes
`ProviderGateway.stream(ChatRequest) -> AsyncIterable<StreamEvent>`; Rich Chat
still calls transitional `startRuntimeStream(ProviderRuntimeChatRequest,
callbacks)`. Cancellation authority is split across Assistant Runtime,
`chatStreamLifecycle`, Zustand streaming state, the rich provider bridge, and
message status. Provider-native and tagged-MCP continuations use separate rich
callback synthesis paths instead of the existing canonical model-operation
loop; tagged-MCP task identity does not include an argument digest.

Durable stream events are bounded diagnostic evidence, not a replay log. Tool
arguments/provider metadata and terminal/error/tool-result lifecycle events are
not retained, and the canonical adapter currently lacks provider trace callback
parity. Per-event run checkpoint writes rewrite accumulated output and require a
terminal write barrier, producing high write amplification for long responses.

### 3.2 Persistence, deletion, and recovery boundary

User input is accepted into Zustand before the asynchronous SQLite write is
awaited. The transitional plain handoff also writes directly through the
repository, outside the store's serialized mutation tail. Rich finalization
derives terminal assistant output from Zustand after durable run creation, so
the disposable UI projection is still part of a success path. Restart recovery
fences running provider work as interrupted; it does not resume a provider
stream. Detached post-success Memory extraction can be lost on process death.

Deleting one conversation does not consistently remove conversation-scoped
memories, Knowledge context snapshots, RAG replay snapshots, or evaluation
records. Full reset clears canonical Knowledge and its derived indexes, but the
separate context-snapshot, replay, and evaluation stores have no verified reset
participant or retention policy. The shared migration ledger also uses the
same `knowledge` scope/version pair for canonical Knowledge v3 and RAG replay
v3; code inspection suggests first-initializer-wins collision risk, which must
be confirmed against an actual device database.

## 4. Current UI/UX Problems

The information architecture has separate Knowledge, Memory, and Context routes,
but all three are backed by the large `ContextPanel.tsx` component. It owns
settings, imports, review queues, local models, caches, diagnostics, evaluations,
filters, and destructive actions. This creates a large render and maintenance
surface even when each route shows only one concern.

The default Context experience also exposes implementation vocabulary:

- RAG mode and four profiles;
- embedding route and local model mirror;
- eight Agentic strategy toggles;
- cache clearing, index rebuilding, evaluation, and self-test tools.

All eight technique settings default to enabled. Progressive disclosure reduces
visual density but does not reduce runtime complexity or the number of concepts
the user must reason about. The UI also overstates fallback heuristics by using
the names of dedicated methods or models.

The useful parts should remain: simple Knowledge/Memory enablement, import
status, recoverable indexing failures, memory review, source visibility, and
clear deletion controls.

## 5. Delete Or Merge Candidates

Deletion must follow replacement tests and persistence checks, but the target
list is explicit.

### Delete after the simple pipeline is live

- Hash-vector retrieval as a user-visible semantic capability.
- ColBERT-lite, GraphRAG-lite, RAPTOR-lite, and FLARE orchestration.
- The eight named technique switches and their product-facing translations.
- The current LLMLingua and cross-encoder names when no corresponding model is
  used. A generic deterministic compressor or lexical reranker may remain under
  an honest name.
- Duplicate per-query caches that do not have a measured hit-rate benefit.
- Separate RAG and Assistant Runtime final-packing budgets.
- Transitional Rich `startRuntimeStream` callback bridge and redacted activity
  snapshot after canonical request, event, continuation, cancellation, route,
  and terminal-receipt parity is proven.

### Merge

- Repeated chunk selection, scoring, compression, and metadata assembly in
  `ragOrchestration.ts` into one candidate-ranking path.
- Duplicate context models in `src/types/contextContracts.ts` into their owning
  Conversation, Knowledge, or Assistant Runtime contract.
- Transitional secondary/indexed search adapters after bootstrap uses one
  Knowledge retrieval entry and focused replacement tests pass.
- Rich provider-native and tagged-MCP continuations into the existing canonical
  model-operation protocol, including argument-digest idempotency, confirmation,
  tool-result receipts, cancellation, usage, and terminal state.
- The multiple active-stream/cancellation authorities into Assistant Runtime as
  the owner, with Zustand retaining only a disposable UI projection.
- Legacy `src/types/contextContracts.ts` Memory/Document/Chunk and Retrieval
  models after all consumers use the Knowledge-owned durable records and
  explicit runtime/UI projections.
- Context Settings diagnostics and evaluation controls into a development or
  troubleshooting surface rather than ordinary user settings.

### Retain

- SQLite and FTS5.
- Knowledge documents/chunks, citations, source scopes, import status, and
  explicit rebuild after an embedding identity change.
- User-reviewable Memory facts and explicit delete/disable controls.
- Provider capability discovery and normalized provider-neutral dispatch.
- The existing callback-to-`AsyncIterable` provider adapter where it satisfies
  the canonical request/event contract; do not add a second queue/bridge.
- Cancellation, durable journals, boundary validation, and redaction. These are
  correctness requirements, not optional architecture ceremony.
- The existing model-operation turn protocol and task receipts; the migration
  should route rich continuations into them rather than create a third tool
  abstraction.

## 6. Recommended Architecture

No new top-level business module is required.

```text
Presentation
  -> Conversations: capture current turn and history identity
  -> Assistant Runtime: execute one durable turn
       -> Conversations: load bounded message window / summary checkpoint
       -> Knowledge: return typed memory and document candidates
       -> Integrations: return admitted attachment/tool contributions
       -> Providers: return model capabilities
       -> Context Planner: allocate, deduplicate, pack, and freeze once
       -> Providers: dispatch the frozen provider-neutral request
       -> Assistant Runtime: journal stream and terminal receipt
       -> Conversations: commit final message from the durable terminal output
       -> Knowledge: extract/update memory after a successful turn
```

Ownership stays narrow:

- **Conversations** owns messages, conversation metadata, summaries linked to a
  message boundary, and message pagination.
- **Knowledge** owns documents, chunks, structured memory facts, retrieval, and
  citations. Memory does not need a separate module.
- **Assistant Runtime** owns the single turn lifecycle, global context budget,
  final plan, exact snapshot, dispatch, journal, cancellation, and recovery.
- **Providers** owns capability discovery, request serialization, streaming,
  and provider-specific compact support. It does not choose knowledge policy.
- **Settings** stores a small profile and privacy choices, not an orchestration
  graph.
- **Bootstrap** binds repositories and provider effects. It does not decide how
  a turn is planned.
- **Tasks/Integrations** remain the owner of explicitly admitted workflow and
  tool side effects; they are not silently folded into ordinary message
  persistence.

Only substitutable effects need ports: conversation persistence, knowledge
persistence/search, optional embedding/rerank operations, provider dispatch,
and the run journal. Candidate scoring, budget allocation, conflict resolution,
and packing are direct pure functions.

### Target provider boundary

`Model Runtime` owns turn admission, capability checks, request identity,
context-plan freezing, cancellation, retry admission, terminal receipt, and
continuation policy. `Providers` owns only provider/model capability evidence,
credential policy, wire serialization, transport retry/fallback, and normalized
incremental events. Capability facts are explicit (`tools`, `vision`,
`structuredOutput`, `embeddings`, context/input/output limits, usage support),
and are frozen with the turn. Provider-specific request types never leak into
Conversation, Knowledge, Context, or Settings policy. No ProviderFactory or
CapabilityManager is needed: one gateway plus capability data is sufficient.

### Current system trace (observed, not target)

```text
Composer/UI
  -> chatStore.addMessage (optimistic projection + asynchronous whole-row save)
  -> conversationReplyDispatchController
     -> Tasks/work-artifact lane, or ordinary Assistant Reply lane
  -> provider admission / workspace admission
     -> narrow plain handoff OR rich context/tool handoff
  -> ContextSnapshotAssembler and/or knowledgeContextRuntime
     -> memory FTS + knowledge FTS + hybrid/agentic indexes
     -> RAG-local pack (often ~2,800 tokens)
  -> Assistant Runtime planning/packing (second budget)
  -> canonical ProviderGateway.stream(ChatRequest)
     OR rich ProviderRuntimeChatRequest/startRuntimeStream callbacks
  -> Zustand streaming projection + AssistantRun journal/checkpoint
  -> rich finalization/tool/MCP revisions and workspace writeback
  -> conversation JSON projection + detached Memory extraction
```

```text
Current durable stores
  conversation_records(metadata only)
  conversation_record_state + conversation_message_records
  assistant_runs + request snapshots + stream.event journal
  memories / knowledge_documents / knowledge_chunks
  memory_fts / knowledge_fts
  derived hybrid / ColBERT / agentic indexes
  knowledge_context_snapshots / knowledge_rag_replay_snapshots /
  rag_evaluation_logs
```

The principal dependency direction is Presentation -> bootstrap/module public
APIs -> owner application/domain policy -> typed ports -> concrete SQLite,
provider, native, and task adapters. The observed exceptions are transitional:
plain handoff direct repository writes, legacy `src/types/contextContracts.ts`
models, rich callback provider requests, and the broad ContextPanel settings
surface.

## 7. Recommended Data Model

### Conversation storage

```text
conversation
  id, title, providerId, modelId, createdAt, updatedAt, revision

message
  id, conversationId, ordinal, role, durableStatus, contentJson,
  createdAt, updatedAt, tokenEstimate, parentMessageId?

conversation_summary
  id, conversationId, throughOrdinal, summary, sourceMessageHash,
  modelIdentity?, createdAt
```

Messages are now incrementally writable and independently addressable; bounded
page APIs are live for history consumers. Existing JSON rows are read only by
startup migration. That migration writes normalized rows transactionally,
isolates malformed rows, and strict portable recovery verifies complete
record/state/message coverage. Healthy schemas rebuild `conversation_records`
without the old payload column; malformed legacy rows retain their original
bytes until a later lossless retry can remove it.

`durableStatus` describes committed outcomes such as complete, interrupted, or
failed. `sending` and `streaming`, partial trace buffers, timers, selected text,
and optimistic UI errors remain runtime/UI projections. A bounded partial-output
checkpoint may be retained in Assistant Runtime for diagnosis/recovery fencing;
it is not the Message entity and does not turn the stream into event sourcing.

### Structured memory

```ts
type MemoryFact = {
  id: string
  scope: { kind: 'user' | 'conversation'; id: string }
  subject: string
  key: string
  value: string
  status: 'pending' | 'active' | 'superseded' | 'disabled'
  confidence: number
  sensitivity: 'normal' | 'sensitive'
  sourceMessageIds: string[]
  validFrom?: number
  validUntil?: number
  supersedesId?: string
  createdAt: number
  updatedAt: number
  lastConfirmedAt?: number
}
```

The unique logical key is `{scopeKind, scopeId, normalizedSubject,
normalizedKey, status=active}`. A new conflicting value creates a pending fact
or supersedes the active fact according to confidence and sensitivity policy.
It never silently keeps two current truths.

### Knowledge and embeddings

```text
knowledge_document
  id, title, mimeType, contentHash, status, source, createdAt, updatedAt

knowledge_chunk
  id, documentId, ordinal, content, contentHash, headingPath?, tokenEstimate

embedding_index
  chunkId, providerId, modelId, dimension, normalization, revision,
  vector, createdAt
```

Changing provider, model, dimension, normalization, or chunking revision creates
a different index identity. Incompatible vectors are never compared or silently
overwritten. FTS remains usable while an optional semantic index rebuilds.

### Context candidates and final plan

```ts
type ContextCandidate = {
  id: string
  kind: 'memory' | 'knowledge' | 'attachment' | 'tool'
  content: string
  sourceIds: string[]
  scope: string
  authority: 'user_fact' | 'document' | 'tool_result' | 'untrusted_external'
  lexicalRank?: number
  semanticRank?: number
  confidence: number
  estimatedTokens: number
  updatedAt?: number
}

type FrozenContextPlan = {
  schema: 1
  conversationId: string
  runId: string
  providerId: string
  modelId: string
  capabilityRevision: string
  budget: ContextBudgetReport
  messages: ProviderNeutralMessage[]
  manifest: ContextManifestItem[]
  compression: CompressionReport
  requestHash: string
  createdAt: number
}
```

The durable snapshot stores this exact final plan, not only source IDs. Secrets,
raw credentials, and unbounded provider payloads remain excluded.

### Durable versus runtime versus UI records

| Record | Durable authority | Runtime-only fields | UI projection |
| --- | --- | --- | --- |
| Conversation/message | Conversation repository | active stream handle, timers, optimistic status | list rows, bubbles, composer state |
| Tool call/result | Tasks/Integrations receipt with argument digest and approval state | provider deltas and parser buffers | progress, confirmation, result preview |
| Citation/attachment | bounded citation/provenance and attachment metadata | fetch/parse progress and binary buffers | source chips and previews |
| Usage | terminal provider receipt and bounded estimates | partial counters | cost/token display |
| Context plan | Assistant Runtime frozen plan/manifest/budget hash | candidate traces and scoring intermediates | optional diagnostics |
| Provider/model config | Providers settings/capability identity | controllers, credentials, retry state | Provider/Model selectors |

`reasoning`, raw trace metadata, SSE buffers, provider response blocks,
`AbortController` instances, and transient `sending`/`streaming` state are not
Conversation entities. Tool arguments and results are durable only when they
cross the Tasks/Integrations authority boundary; a generic stream event is not
enough to reconstruct them.

## 8. Context, Retrieval, And Memory Pipeline

### 8.1 One turn pipeline

1. **Freeze turn identity.** Resolve conversation revision, current user
   message, provider/model capability revision, enabled features, and deadline.
2. **Create retrieval intent.** Use the current user request plus a small amount
   of local conversational disambiguation. Do not include the full system prompt.
3. **Retrieve independently.** Query scoped active Memory facts and scoped
   Knowledge chunks. FTS is always available. Run semantic search only when a
   compatible, complete index exists.
4. **Fuse once.** Combine lexical and semantic ranks with reciprocal rank fusion
   when both exist. Do not compare raw BM25 and cosine scores.
5. **Resolve conflict and duplication.** Prefer current, scoped, higher-authority
   facts; group overlapping chunks; keep one source manifest entry per claim.
6. **Allocate one budget.** Reserve output first, then fixed system/tool schema,
   then distribute the remaining input budget across recent history, summary,
   memory, knowledge, attachments, and tool results.
7. **Compress deterministically.** Drop redundant or low-ranked candidates before
   summarizing. Summarize older conversation history at an explicit message
   boundary. Never independently truncate an already cited evidence block.
8. **Render once.** Create ordered provider-neutral messages and the manifest
   from the same selected items.
9. **Persist before dispatch.** Save the exact frozen plan atomically with the
   run-created journal event and ensure the accepted user message is durable
   before provider effects start.
10. **Dispatch and journal.** Serialize in Providers, stream through Assistant
    Runtime, persist coalesced bounded deltas/checkpoints, record one terminal
    receipt, and derive the final Conversation message from that durable output.
11. **Learn after success.** Run deterministic Memory extraction even without a
    Provider key. Optional model-assisted extraction may add candidates but
    cannot suppress local results or block the completed turn.

### 8.2 Budget policy

The model's verified input/output limits are the only top-level budget. A
reasonable starting policy is:

- reserve requested output and a fixed safety margin;
- always include the current user message and required system/tool definitions;
- favor recent conversation turns;
- give Memory a small capped budget because concise facts should be high value;
- let Knowledge use the remaining evidence budget;
- reduce candidate count before reducing individual evidence below a useful
  citation span;
- expose the final allocation in diagnostics, not as eight user settings.

Exact ratios must be tuned against representative conversations and models.

### 8.2a Target retrieval pipeline

```text
query intent
  -> scoped active Memory FTS
  -> scoped Knowledge FTS
  -> optional identity-compatible semantic lane
  -> one rank fusion (RRF; never raw-score arithmetic)
  -> authority/conflict filtering
  -> duplicate/overlap collapse
  -> bounded candidate list
  -> Context Planner budget allocation
```

Memory and Knowledge remain separate sources with separate scope and authority
metadata, but share the same candidate shape and final budget. A unified
retrieval abstraction is justified only at this narrow candidate boundary; each
source keeps its own SQL/index policy. Conversation history is selected by the
Conversations owner, not queried as an unbounded third search index. Web and
tool results enter as explicitly admitted candidates with lower authority and
shorter freshness limits.

### 8.3 Memory lifecycle

- Deterministic extraction proposes a small set of facts after a successful
  user/assistant turn.
- Sensitive, ambiguous, or conflicting facts enter `pending` review.
- A matching scoped key and value updates evidence and `lastConfirmedAt`.
- A matching key with a different value creates a conflict; an accepted value
  supersedes the old fact transactionally.
- Explicit temporal facts may expire through `validUntil`. Ordinary preferences
  do not expire because they were not retrieved for 30 days.
- Users can inspect source, edit/confirm, disable, or delete a fact.
- Deleting a conversation follows an explicit policy: conversation-scoped facts
  are deleted; user-scoped facts retain only approved evidence-safe provenance.

## 9. Candidate Technologies And Open-Source References

| Candidate | Decision | Benefit | Cost / risk | Simpler alternative |
| --- | --- | --- | --- | --- |
| Expo SQLite + FTS5 | Adopt as default | Already in the stack; transactional, offline, exact-term search; Expo enables FTS by default | Tokenization and ranking need language-aware tests | `LIKE` is simpler but loses ranking and scales poorly |
| Room instead of Expo SQLite | Reject for this refactor | Excellent native Android DAO/migration integration | Requires a platform rewrite or parallel native data layer and duplicates the current Expo stack | Keep Expo SQLite and apply the same source-of-truth/repository principles |
| Structured relational storage | Adopt | Enables message pagination, scoped facts, uniqueness, migration, and transactional deletion | Requires a verified migration from JSON snapshots | Retaining JSON blobs is initially simpler but does not meet scale/recovery needs |
| `sqlite-vec` | Optional experiment, not default authority | Small C extension; vectors stay beside local data; Expo can bundle it | Project is pre-v1 and warns of breaking changes; APK/native validation and index migration are required | Bounded JS scan for tiny corpora, or FTS-only |
| Remote embeddings | Opt-in semantic index | Better semantic recall without bundling a model | Privacy disclosure, network cost, model drift, rebuilds | FTS-only default |
| ONNX local embeddings | On-demand privacy/offline profile | No document transmission after model download | APK/storage/RAM/startup cost and device variability | FTS-only offline fallback |
| Remote/local reranker | Optional after measured need | Can improve top-candidate precision | Extra latency/cost/model lifecycle; must fail back to fused ranking | RRF plus lexical overlap filter |
| Conversation summarization | Adopt at explicit message boundaries | Recovers budget from old history and is attributable | Model cost, drift, and stale summaries; must retain source hash/boundary | Drop old turns without summary when evidence is weak |
| Deterministic context compression | Adopt after selection | Cheap, inspectable removal of duplication/noise | Cannot create missing information | Candidate dropping and message-boundary summarization |
| Remote context compression | Provider-capability option only | May preserve meaning better for very long prompts | Privacy, cost, provider coupling, and another failure path | Local deterministic packing and summary checkpoints |
| Episodic memory database | Reject as a new store | Can retrieve past events | Duplicates Conversation history and increases deletion/privacy complexity | Search normalized Conversation messages when a real use case is proven |
| Semantic Memory facts | Adopt inside Knowledge | Editable preferences/facts with scoped evidence and conflict handling | Extraction pollution if review/policy is weak | Manual-only facts for sensitive deployments |
| Remote inference | Keep as main generation path | Broad model quality/capability coverage and no APK model weight | Network, privacy, latency, cost | Local inference profile |
| Local inference | Optional profile | Offline/privacy benefits | APK/storage/RAM/startup/device variance | Remote provider plus local FTS/deterministic Memory |
| Mem0 | Borrow memory lifecycle ideas only | Mature examples of scoped memory, multi-signal retrieval, temporal handling, and evaluation | Its server/platform stack is too large for this client; published managed results are not local SDK proof | Implement the small `MemoryFact` lifecycle locally |
| Letta | Borrow explicit editable/archival memory concepts only | Clear distinction between prompt-resident and searchable memory | Stateful agent server/runtime is outside Chat client needs | Small capped active facts plus archival retrieval |
| Open WebUI | Reference hybrid/rerank behavior and failure reports | Real project evidence that hybrid retrieval and reranking are useful | Its discussions show candidate and multi-query counts can explode; Python/server architecture is not mobile | One FTS query, optional one vector query, one fusion pass |

Do not replace Expo/React Native with native Kotlin solely to imitate Android
sample architecture. Android's useful guidance here is local source of truth,
repository ownership, offline-first behavior, and unidirectional UI state. The
current stack can implement those properties.

## 10. Adoption Rationale

### Why FTS first

FTS5 is mature, local, cheap, deterministic, and strong for names, identifiers,
error codes, and quoted text. It is also available when offline or when no
embedding provider is configured. Its weakness is semantic paraphrase recall;
that is a reason for an optional semantic lane, not a reason to make vectors the
only index.

### Why optional hybrid retrieval

Keyword and semantic retrieval fail differently. When both indexes are valid,
RRF combines their ranks without pretending BM25 and cosine scores have the same
scale. Hybrid remains conditional because some corpora gain little and every
semantic lane adds privacy, indexing, migration, and battery cost.

### Why reranking is not a default

A real cross-encoder or rerank API may improve precision after broad retrieval,
but it adds inference latency and another model identity. It should be enabled
only when the gold set shows a useful gain under the Android latency budget. A
token-overlap heuristic must not be called a cross-encoder.

### Why structured Memory

Text snippets are easy to append but cannot express replacement, conflict,
validity, or evidence. A small fact key/value model solves those user-visible
problems without introducing a graph database or a general ontology.

### Why exact snapshots

Source IDs explain where material originated but not what the model received.
Persisting the final provider-neutral messages, budgets, manifest, and hash
supports diagnostics, recovery fencing, cost analysis, and reproducible tests.

## 11. Target Module Layout

Only create folders that contain real separation:

```text
src/modules/conversations/
  conversation/message domain types
  message window and summary policy
  conversation repository contract
  sqlite normalized repository adapter

src/modules/knowledge/
  document, chunk, memory fact, candidate types
  import and memory update use cases
  FTS retrieval and optional semantic index
  fusion, conflict, and deduplication pure functions
  sqlite knowledge repository adapter

src/modules/assistant-runtime/
  one conversation turn use case
  context budget/planning/packing pure functions
  frozen context snapshot and run journal contracts
  cancellation, streaming, and recovery

src/modules/providers/
  provider/model capability identity
  embedding and rerank operations
  provider-neutral request serialization and stream normalization

src/presentation/features/settings/
  simple Context profile state and commands
  separate Knowledge and Memory screen state
```

Do not create separate Manager, Factory, Registry, DTO, mapper, and adapter files
for every type. A public contract is justified only at module, persistence,
network, native, or durable boundaries.

## 12. Implementation Order And Migration Strategy

### Phase 1: Correct low-risk behavior and freeze the target

- Preserve the now-live deterministic Memory extraction path when Memory is
  enabled, independent of generation-provider credentials.
- Add focused tests for disabled, credential-free, provider-assisted,
  cancellation, and projection-failure behavior.
- Stop enabling or advertising unverified advanced RAG techniques for new
  settings while preserving existing persisted values until migration is
  explicit.

### Phase 2: Unify turn planning

- Reuse the existing Assistant Runtime context types where possible.
- Introduce one final provider-neutral plan result from request planning.
- First make accepted user input and terminal output durable authorities, then
  route ordinary plain and rich Chat through the same acquisition, budget,
  packing, snapshot, dispatch, and journal path. Capabilities contribute items;
  they do not select a runtime. Keep explicit Tasks/work-artifact turns as a
  separately admitted product lane.
- Preserve provider/tool behavior with focused plain, attachment, search, skill,
  and tool-turn tests.

### Phase 3: Make snapshots exact and durable

- Version the snapshot to contain final messages, manifest, budget, compression,
  provider/model capability revision, and request hash.
- Persist it atomically with run creation.
- Add retention and deletion through the owning Data Management reset plan.
- Treat old incomplete snapshots as diagnostic-only and never infer replay
  authority from them.

**Implementation status (2026-08-20): partial.** Assistant Runtime stores an
`AssistantRunRequestSnapshot` containing the final provider-neutral
`ChatRequest` for the canonical ConversationRun path. Model-operation request
preparation completes before `run.created`; the run row, request snapshot, and
first journal entry commit in one transaction before provider dispatch.

Rich Chat now also separates pure provider-request preparation from stream
dispatch. The same prepared request object is used for lifecycle construction
and Provider dispatch, while a versioned
`AssistantRunActivityRequestSnapshot` is frozen and committed atomically with
`run.created`. This Rich snapshot is intentionally safe diagnostic evidence:
credentials, `AbortSignal`, endpoint credentials/query data, and large binary
bodies are redacted or omitted before persistence. It therefore describes the
provider-neutral request semantics but is not a byte-exact replay payload.

Both snapshot forms are deep-frozen on write and read, older run rows remain
readable without fabricated evidence, and full reset deletes `assistant_runs`
so the journal and request-snapshot rows are removed by foreign-key cascade.
Neither snapshot form grants replay authority.

The v7 Assistant Runtime migration now also persists an optional
`AssistantContextPlanReceipt` beside either snapshot. It contains only the
provider/model identity, bounded token budget, compression summary, source
manifest, and failure codes; raw context text is rejected at the persistence
boundary. Plain and rich planning use the same receipt builder, so diagnostics
can compare the two paths without changing the high-impact `ChatRequest`
contract.

Rich activity execution now accepts one optional normalized stream-event
checkpoint callback. It serializes visible text plus bounded citation,
tool-call, usage, and trace-lifecycle markers into the existing `stream.event`
journal and updates the run checkpoint atomically; the Rich durable wrapper
waits for queued checkpoints before invoking terminal completion. The older
text-delta callback remains as a compatibility convenience, and
non-streaming activities remain compatible because both callbacks are
optional.

This is not yet the complete `FrozenContextPlan`: migration v8 now persists a
versioned capability revision and stable request hash beside each new request
snapshot, bound on read to the canonical request or redacted Rich evidence.
The hash is diagnostic drift evidence, not replay or authorization proof, and
legacy snapshots remain readable without invented values. Rich still retains a
redacted activity-evidence envelope for non-replayable provider fields. Exact
planning/dispatch parity is improved, and bounded citation/tool/usage/trace
event evidence now has one durable path across both the initial activity and
nested provider-native/MCP revision streams. Nested continuation state is
checkpointed before tool-call evidence and terminal success waits for the
post-finalization checkpoint barrier, while durable journals continue to redact
arguments and provider metadata. Rich continuation request parity, explicit
interrupted-continuation identity/resume semantics, terminal error/tool-result
events, provider-family recovery parity, and the canonical request cutover
remain open.

### Phase 4: Normalize Conversation persistence

- Normalized state/message tables and authoritative normalized reads are live;
  one malformed legacy payload does not block valid startup migration.
- Addressed reads and portable recovery fail closed on coverage or row-shape
  drift, and Android evidence collectors use normalized rows only.
- The normalized write is now required end to end, and bounded keyset
  pagination is live for history consumers. Healthy and new schemas no longer
  carry the JSON mirror; malformed legacy rows remain isolated and retryable
  without a runtime payload fallback.

### Phase 5: Upgrade Memory

- Complete and validate the existing structured Memory Fact columns,
  activation-time supersession, and scoped active-key uniqueness rule.
- Backfill existing snippets as pending/unstructured facts rather than inventing
  keys with false confidence.
- Implement confirm, supersede, conflict, disable, delete, and evidence display.
- Remove inactivity-based automatic disablement.

### Phase 6: Simplify Knowledge retrieval and Settings

- Make scoped FTS the baseline path and fix score direction/range selection.
- Add one candidate fusion/deduplication pass and one global context budget.
- Replace synthetic-only retrieval floors with a versioned representative
  corpus/gold set and named Android latency, memory, battery, and privacy
  measurements.
- Replace technical switches with `Fast`, `Balanced`, and `Deep` profiles.
- Move rebuild, evaluation, model mirror, and raw diagnostics to Advanced or
  Troubleshooting.
- Delete the lite technique paths after the replacement gold-set gate passes.

### Phase 7: Add semantic retrieval only with evidence

- Define an embedding index identity and rebuild lifecycle.
- Evaluate `sqlite-vec` in a pinned native build or retain the simpler bounded
  index for small corpora.
- Require disclosure before remote document chunks are embedded.
- Add reranking only when it improves the project gold set under device latency,
  memory, battery, and cost budgets.

### Phase 8: Data migration and destructive cleanup

- Migrate normalized Conversation and Memory records transactionally, verify
  counts/hashes/logical keys, and retain only a bounded rollback reader.
- Assign unique migration-ledger scope/version identities to canonical
  Knowledge, derived indexes, context snapshots, replay snapshots, and
  evaluation stores; verify an existing device database before changing them.
- Add explicit conversation-delete and full-reset participants for every owned
  durable store before deleting compatibility readers.
- Remove dual writers, legacy models, temporary request snapshots, source-marker
  tests, and product settings only after their deletion gates pass.

### Phase 9: Full validation and release evidence

- Correctness: migration, partial failure, cancellation, retry, interruption,
  pending confirmation, deletion, export/import, and recovery fencing.
- Performance: message append/pagination, FTS and optional semantic retrieval,
  import/index jobs, coalesced stream writes, context tokens, and provider
  latency on named release/profile Android builds.
- Architecture: dependency direction, public entries, cycles, compatibility
  deletion, abstraction/table/configuration counts, and no presentation
  authority in durable runtime decisions.
- UX: Provider -> Model -> Chat default path, progressive disclosure,
  accessibility, loading/error/offline/cancellation states, and destructive
  action clarity.

Each phase must remain independently buildable. No phase retains a permanent
dual writer or compatibility facade without a named deletion condition.

## 13. Further Simplification Opportunities

### Complexity budget

Every new module, public interface, durable model, repository, factory, mapper,
event type, setting, or table must identify its boundary and deletion/rollback
condition. A local pure helper does not earn a port; a module export requires a
real cross-module consumer; a derived index requires a rebuild identity and
reset participant; a durable event requires a recovery or diagnostic question
that cannot be answered by the terminal receipt. The migration target is fewer
decision points, not a larger count of layers.

1. Use one `Balanced` default instead of deriving eight booleans.
2. Keep Memory inside Knowledge ownership instead of creating another module.
3. Use FTS-only when semantic capability is absent or rebuilding.
4. Use one retrieval query unless the gold set proves query expansion helps a
   specific class of questions.
5. Use one global context budget and remove downstream emergency truncation.
6. Persist one exact final snapshot instead of separate partially overlapping
   debug snapshots, while retaining bounded diagnostic-only evidence only where
   privacy and recovery policy require it.
7. Make diagnostics explain the chosen sources and budget; do not expose the
   internal algorithm graph as ordinary settings.
8. Move large import/index work off the interaction path and process bounded
   chunks with cancellation and visible progress.
9. Prefer delete-and-rebuild for derived embeddings over elaborate vector data
   migrations. Documents, chunks, and Memory facts are the durable authority.
10. Keep FTS and structured Memory even if every optional model is unavailable.
11. Replace the no-op lazy indexed-search driver and one-consumer import
    validation wrappers only after cancellation and untrusted-boundary tests
    prove that the direct path is equivalent.

## Acceptance Criteria

The modernization is complete when:

- every eligible ordinary Chat turn produces the same versioned frozen context
  plan shape;
- optional attachments/search/skills/tools do not bypass planning or journaling
  (explicit Tasks/work-artifact turns are governed by their own admitted
  protocol);
- the exact final provider-neutral request can be inspected from durable data
  for every ordinary Chat path, while any redacted diagnostic evidence is
  clearly marked non-replayable;
- conversation messages are incrementally persisted and pageable;
- Memory facts support evidence, scoped updates, conflicts, supersession, and
  user deletion without inactivity-based data loss;
- FTS works offline and semantic indexes are strictly identity-isolated;
- no user-facing label claims a model or algorithm that is not actually used;
- default Settings require no RAG terminology;
- retrieval quality is measured on a versioned project gold set;
- focused tests, type-check, architecture gates, reset/export tests, and named
  Android release/profile evidence pass.

## Architecture Decision Gate

The product owner explicitly accepted the following decision on 2026-08-20.

```text
ARCHITECTURE DECISION

KEEP
- Expo/React Native, SQLite as local authority, FTS5 baseline, Knowledge-owned
  structured Memory, provider-neutral ChatRequest/StreamEvent contracts,
  Assistant Runtime cancellation/redaction/recovery fences, Tasks permission
  and operation receipts, and bootstrap-only concrete adapter composition.

REFACTOR
- One ordinary Chat turn planner and one durable input/output authority.
- Conversation persistence into normalized, pageable messages after authority
  cutover.
- Context candidates, deduplication, ranking, budgeting, compression, and
  manifest into one final packing pass.
- Settings into simple defaults with progressive disclosure.
- Memory extraction, scoped conflict policy, evidence, and deletion semantics.
- Knowledge import/index jobs with explicit identity, cancellation, and reset.

MERGE
- Legacy and vNext Conversation/Knowledge/Context models into owner-owned
  durable records plus explicit runtime/UI projections.
- RAG and Assistant Runtime final packing budgets.
- Rich provider-native and tagged-MCP continuations into the existing canonical
  model-operation/task protocol.
- Stream/cancellation authorities into Assistant Runtime; Zustand remains a UI
  projection only.

DELETE
- User-visible hash-vector, ColBERT-lite, GraphRAG-lite, RAPTOR-lite, FLARE,
  misleading cross-encoder/LLMLingua labels, unmeasured duplicate caches,
  legacy context models, whole-payload conversation writes, and the Rich
  callback/activity compatibility bridge after parity gates pass.

INTRODUCE
- A minimal FrozenContextPlan and budget report, normalized message tables,
  embedding-index identity, bounded/coalesced stream checkpoints, explicit
  Knowledge snapshot/replay/evaluation retention participants, and a single
  terminal output receipt.

REJECT
- A new top-level Memory module, vector database as the default authority,
  mandatory embeddings/reranking, graph database, generic event bus,
  ProviderFactory/RegistryFactory/Manager layers, permanent dual writers,
  broad event sourcing, or treating diagnostic stream evidence as replay
  authority.
```

### Why this architecture, and not the alternatives?

It keeps the current Expo/SQLite deployment and the existing ownership plan,
but removes duplicated decision points rather than adding framework-shaped
layers. FTS5 gives an offline, deterministic baseline; semantic search remains
an evidence-gated optional index. Structured Memory solves user-visible conflict
and editability without a graph database. One frozen plan prevents retrieval,
provider, and UI paths from silently applying different budgets. The existing
model-operation protocol already supplies validation, confirmation,
idempotency, cancellation, and terminal receipts, so adding another tool
runtime would increase rather than reduce complexity.

The highest-risk change is `runAgenticRag`: GitNexus reports HIGH risk (4 direct
callers, 10 impacted symbols, Bootstrap/Application/Settings). It must not be
rewritten in place before a replacement retrieval contract and compatibility
fixtures exist. Current RAG and memory evaluations are synthetic fixtures, not
Android release-device or representative-corpus evidence; those measurements
remain an explicit implementation gate.

Implementation must remain incremental and obey the named compatibility and
deletion gates. The current worktree was already dirty before this audit;
unrelated changes must remain untouched.

## A-T Coverage Index

| Requested output | Covered by this audit |
| --- | --- |
| A Executive Summary | Executive Decision + sections 1-3 |
| B Current Architecture | Current system trace and current durable stores |
| C Architecture Problems | sections 1 and 3 |
| D Conversation Problems | section 2.1 and Conversation storage |
| E Knowledge Problems | section 2.2 and Knowledge pipeline |
| F Memory Problems | section 2.3 and Memory lifecycle |
| G Context Problems | section 3 and Context pipeline |
| H Retrieval Problems | sections 2.2, 3, and Retrieval pipeline |
| I Provider Problems | section 3.1 and Provider rationale |
| J UI/UX Problems | section 4 |
| K Delete/Merge/Simplify | section 5 and decision gate |
| L Target Architecture | section 6 |
| M Target Data Model | section 7 |
| N Target Context Pipeline | section 8.1-8.2 |
| O Target Retrieval Pipeline | section 8.1 and technology rationale |
| P Target Memory Pipeline | section 8.3 |
| Q Technology Evaluation | section 9 |
| R Migration Strategy | section 12 |
| S Implementation Order | section 12, with authority cutover first |
| T Complexity Reduction | section 13 and decision gate |

## External Sources

- Android data layer and source of truth:
  <https://developer.android.com/topic/architecture/data-layer>
- Android architecture recommendations and unidirectional data flow:
  <https://developer.android.com/topic/architecture/recommendations>
- Android offline-first guidance:
  <https://developer.android.com/topic/architecture/data-layer/offline-first>
- Expo SQLite, FTS build option, and bundled `sqlite-vec` support:
  <https://docs.expo.dev/versions/latest/sdk/sqlite/>
- SQLite FTS5 reference: <https://www.sqlite.org/fts5.html>
- `sqlite-vec` repository and pre-v1 warning:
  <https://github.com/asg017/sqlite-vec>
- Mem0 scoped/long-term memory reference: <https://github.com/mem0ai/mem0>
- Letta stateful and archival memory reference: <https://github.com/letta-ai/letta>
- Open WebUI hybrid/rerank implementation:
  <https://github.com/open-webui/open-webui/pull/1693>
- Open WebUI hybrid-scan scaling discussion:
  <https://github.com/open-webui/open-webui/discussions/12621>
