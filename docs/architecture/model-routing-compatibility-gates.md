# Model Routing Compatibility Gates

## Scope

Model routing is the practical version of a mixture-of-models architecture for IsleMind. The router may choose a cheap model, local model, strong reasoning model, vision model, tool-capable model, or fallback provider only when the decision is capability-aware, budgeted, privacy-safe, and observable.

Local gate:

- Schema: `islemind.model-routing-compatibility-eval.v1`
- Service: `src/services/modelRoutingCompatibilityEvaluation.ts`
- Script: `scripts/model-routing-compatibility-tests.js`
- Package entry: `bun run test:model-routing-compatibility`

Architecture stance:

- Route selection must use provider/model capability evidence, not provider name heuristics alone.
- Cheap or local models are valid for narrow classification, embedding, and privacy-sensitive work.
- Strong reasoning, vision, tools, structured output, cache continuation, and provider-native tool replay require explicit model metadata.
- Fallback may degrade only non-critical capabilities, and the downgrade must be visible and audited.
- Local-only/private data cannot silently route to cloud providers.
- Provider-native response ids, cache state, and tool replay ids cannot be reused across providers.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `cheap-intent-classifier-small-model` | Cheap/small model routing | Selects a low-cost, low-latency classifier only for narrow intent-classification capability. |
| `privacy-local-embedding-route` | Local privacy route | Keeps private embedding work on local/on-device capability. |
| `reasoning-upgrade-route` | Strong reasoning route | Upgrades to a reasoning-capable model only with budget and metadata evidence. |
| `vision-capability-route` | Vision route | Sends image work only to a model with vision capability metadata. |
| `structured-output-model-gated-route` | Typed output route | Sends strict-schema workflows only to models that support structured output. |
| `tool-capable-agent-route` | Tool workflow route | Sends tool workflows only to models with tool and replay capability. |
| `fallback-with-visible-downgrade` | Visible fallback | Allows audited fallback when required capabilities remain present and downgrade is user-visible. |
| `blocked-unsupported-capability-downgrade` | Unsafe fallback | Blocks fallback that drops required reasoning, tool, vision, or schema capability. |
| `blocked-private-data-cloud-route` | Privacy violation | Blocks cloud routing for local-only/private data without redaction and policy. |
| `blocked-budget-overrun-route` | Budget violation | Blocks routes whose predicted cost or latency exceeds workflow budget. |
| `blocked-cross-provider-state-replay` | Provider state mismatch | Blocks cross-provider cache continuation, response-id replay, and provider-tool replay. |

## Diagnostic Contract

Each diagnostic records:

- selected provider/model and fallback provider/model,
- provider class and routing description,
- required and selected capabilities,
- decision reasons,
- readiness: `ready`, `degraded`, or `blocked`,
- metadata freshness, capability evidence, privacy mode, private-data flag, redaction status,
- cost and latency budgets,
- fallback visibility and downgrade policy,
- provider-state replay scope, cache continuation match, provider-tool replay id match,
- audit event and failure codes.

## Adoption Rule

Before adding new router modes, model pools, auto-fallback policies, local/cloud split routing, model scoring, or provider-native state continuation, extend this gate with a fixture for the new path. Any path without capability evidence, fresh model metadata, privacy policy, cost/latency budget, visible fallback behavior, and provider-state isolation must stay blocked.
