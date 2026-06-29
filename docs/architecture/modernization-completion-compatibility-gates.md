# Modernization Completion Compatibility Gates

## Scope

Modernization completion is the cross-layer audit that prevents "complete" from meaning only architecture cleanup. It requires every major layer to prove a source boundary, versioned schema, deterministic fixture set, package script, documentation gate, blocked-path coverage, runtime observability, privacy redaction, user recovery, QA evidence, release evidence, and behavior preservation.

Local gate:

- Schema: `islemind.modernization-completion-compatibility-eval.v1`
- Service: `src/services/modernizationCompletionCompatibilityEvaluation.ts`
- Script: `scripts/modernization-completion-compatibility-tests.js`
- Package entry: `bun run test:modernization-completion-compatibility`

Architecture stance:

- A modernization layer is not complete until it has source code, a package-visible test, and an architecture doc.
- Capability expansion must be blocked when it lacks metadata, deterministic fixtures, a quality gate, or blocked-path cases.
- User-facing modernization must prove diagnostics, redaction, trace visibility, and recovery behavior.
- Delivery modernization must prove release readiness and QA evidence before promotion.
- The completion gate itself must remain local/offline and must preserve existing public behavior.

## Fixture Set

| Fixture | Layer | Required behavior |
| --- | --- | --- |
| `architecture-boundary-modernized` | Architecture | Requires source boundaries, public behavior preservation, docs, package script coverage, and architecture audit readiness. |
| `provider-capability-platform` | Provider | Requires capability metadata across provider protocol, request shaping, lifecycle, runtime, health, failover, fallback, state, and operation-result gates. |
| `context-retrieval-governance` | Context | Requires context, retrieval, RAG, document ingestion, memory, local inference, and budget governance gates. |
| `agent-tool-workflow-bounds` | Agent | Requires agent workflow, MCP, plugins, typed tools, execution, reasoning, multimodal, realtime, and model routing gates. |
| `security-privacy-credential-retention` | Security | Requires agent security, credential governance, provider-state isolation, runtime privacy/retention, and redaction gates. |
| `product-experience-recovery` | Product | Requires entry points, diagnostics, recovery, deduplicated errors, confirmations, offline fallback, accessibility, and localization. |
| `observability-runtime-traces` | Observability | Requires runtime events, trace spans, eval telemetry, repair provenance, sink policy, consent, budgets, and redaction. |
| `release-readiness-delivery` | Release | Requires source stability, APK freshness, URL safety, integrity, staged cleanup, install handoff, smoke, 16 KB validation, and QA evidence. |
| `qa-evidence-registry` | Quality | Requires package scripts, deterministic fixtures, architecture docs, QA evidence, and blocked-path cases. |
| `blocked-ungated-capability-expansion` | Provider | Blocks capability expansion without schema, script, source boundary, doc, fixtures, quality gate, metadata, or blocked paths. |
| `blocked-silent-or-raw-user-facing-failure` | Product | Blocks silent failures, raw technical errors, missing traces, missing redaction, and missing recovery. |
| `blocked-delivery-without-evidence` | Release | Blocks delivery changes without package script, quality gate, release evidence, QA evidence, and blocked-path coverage. |

## Diagnostic Contract

Each diagnostic records:

- layer,
- readiness: `ready` or `blocked`,
- versioned schema, package script, source boundary, documentation gate, deterministic fixtures, quality gate, runtime trace, privacy redaction, capability metadata, user recovery, release evidence, QA evidence, blocked-path fixtures, network independence, public behavior preservation, and failure codes.

## Adoption Rule

Before declaring the modernization goal complete, run this gate after the layer-specific gates that changed in the pass. A layer with no source boundary, package script, doc gate, deterministic fixtures, blocked-path coverage, trace/redaction policy, release evidence, or QA evidence remains incomplete even when type-checking passes.
