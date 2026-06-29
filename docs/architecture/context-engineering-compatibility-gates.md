# Context Engineering Compatibility Gates

## Scope

Context engineering is the control system above RAG. It decides which memory, retrieval, tool output, attachments, summaries, and provider state are model-visible, how much budget they receive, how provenance is proven, and how fallback or compression decisions are explained.

Local gate:

- Schema: `islemind.context-engineering-compatibility-eval.v1`
- Service: `src/services/contextEngineeringCompatibilityEvaluation.ts`
- Script: `scripts/context-engineering-compatibility-tests.js`
- Package entry: `bun run test:context-engineering-compatibility`

Architecture stance:

- Every model-visible context fragment needs a finite token cap, source hash, provenance, reliability, and visible decision.
- Retrieval context must preserve ranking, source reliability, provenance, and citation traces.
- Memory context must stay source-attributed, user-reviewed where required, redacted, and separated from public-source lanes.
- Tool-output context must come from permissioned tools and remain capped, audited, and redacted.
- Remote compact must have a local fallback plan and visible degradation state.
- Context manifests and runtime events must omit raw context bodies and remain non-networked control-plane artifacts.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `long-context-budgeted-assembly` | Long-context planning | Proves finite token budget, visible compression decision, and no raw text serialization. |
| `retrieval-provenance-citation` | Retrieval context | Requires source hash, provenance, ranking, reliability, and citation trace. |
| `memory-review-boundary` | Memory context | Requires source attribution, user review, redaction, and authority separation. |
| `tool-output-permissioned-context` | Tool context | Requires permission checks, token cap, source hash, redaction, and audit events. |
| `remote-compact-local-fallback` | Compact fallback | Allows degraded fallback only when local fallback and visible decision are present. |
| `context-cache-reuse-hash` | Cache reuse | Requires stable source hashes and cache reuse diagnostics. |
| `runtime-manifest-observability` | Context manifest | Requires manifest/runtime events without raw context text or network calls. |
| `blocked-unbounded-context-source` | Unbounded source | Blocks uncapped or unhashable model-visible context. |
| `blocked-raw-context-manifest` | Raw context leakage | Blocks manifests/logs that serialize raw context, skip redaction, or perform network calls. |
| `blocked-cross-authority-memory-leak` | Authority leak | Blocks private memory entering public lanes or bypassing review/redaction. |

## Diagnostic Contract

Each diagnostic records:

- source kind and authority,
- readiness: `ready`, `degraded`, or `blocked`,
- token budget and estimated tokens,
- source hash, provenance, citation trace, permission check, review status, redaction, ranking, reliability, compact mode, compact fallback, cache reuse, runtime events, visible decision, control-plane network status, authority-leak status, and failure codes.

## Adoption Rule

Before adding new context lanes, ranking strategies, memory-write modes, tool-output injection, compact reuse, provider cache continuation, or manifest export, extend this gate with a fixture for the new path. Any model-visible context without finite budget, source hash, provenance, reliability, redaction, visible decision, and authority separation must stay blocked.
