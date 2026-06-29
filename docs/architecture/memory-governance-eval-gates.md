# Memory Governance Eval Gates

## Scope

Agent memory is a high-value AI direction, but IsleMind must keep long-term memory local-first, reviewable, and reversible. The local governance gate evaluates memory behavior before adopting mem0, Zep Graphiti, Letta, graph memory, or autonomous memory-writing patterns.

Local gate:

- Schema: `islemind.memory-governance-eval.v1`
- Service: `src/services/memoryGovernanceEvaluation.ts`
- Script: `scripts/memory-governance-tests.js`
- Package entry: `bun run test:memory-governance`

Reference stacks:

- mem0
- Zep Graphiti
- Letta

These are reference designs, not runtime dependencies.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `manual-user-preference` | Explicit user memory command | Can become active long-term memory with source message, claim, confidence, and deletion path. |
| `model-inferred-preference` | Model-inferred preference | Must stay pending with visible review; no autonomous active write. |
| `mem0-import-review` | External mem0-style import | Must keep imported source detail and stay pending before long-term use. |
| `conversation-summary-scope` | Generated continuation summary | Must remain session-scoped generated summary, not long-term memory. |
| `conflicting-preference` | New claim conflicts with existing memory | Must detect conflict, keep pending, and require review instead of overwriting. |
| `knowledge-source-boundary` | Imported document fact | Must remain knowledge retrieval context, not user memory. |
| `provider-response-boundary` | Provider answer content | Must remain provider response context, not user memory. |
| `deletion-request-path` | User forget request | Must record a deletion path and disable/remove the matching memory. |

## Diagnostic Contract

Every diagnostic records:

- source message id,
- extracted claim,
- source kind and source detail,
- scope,
- retrieval kind,
- confidence,
- retention class,
- write action,
- memory status,
- conflict policy,
- deletion path,
- visible-review requirement,
- failure codes.

## Adoption Rule

Before IsleMind adds autonomous memory extraction, graph memory, external memory sync, or memory-agent workflows, this gate must pass and be extended with the new behavior. Runtime memory writes should remain pending by default unless the user explicitly confirms the memory or the feature has a separate user-visible approval surface.
