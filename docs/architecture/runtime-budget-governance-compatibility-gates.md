# Runtime Budget Governance Compatibility Gates

## Scope

Runtime budget governance is the boundary between request planning and work that can spend tokens, cost, latency, retries, tool calls, stream time, local memory, or device thermal headroom. This gate keeps AI runtime expansion bounded before IsleMind adds wider reasoning loops, provider fallback, local inference, realtime media, or executable tool workflows.

Local gate:

- Schema: `islemind.runtime-budget-governance-compatibility-eval.v1`
- Service: `src/services/runtimeBudgetGovernanceCompatibilityEvaluation.ts`
- Script: `scripts/runtime-budget-governance-compatibility-tests.js`
- Package entry: `bun run test:runtime-budget-governance-compatibility`

Architecture stance:

- Provider requests must normalize input-token, output-token, cost, latency, and timeout budgets before request shaping.
- Retries must remain bounded and tied to circuit breaker behavior.
- Streams need idle timeouts and cancellation propagation.
- Fallback may only preserve or reduce budget and capability commitments unless the user sees and approves the escalation.
- Local inference needs memory and thermal policy before model work starts.
- Tool loops need finite tool-call, token, timeout, and cost budgets.
- Diagnostics should record budget ledger fields without raw prompts, secrets, or tool payloads.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `token-budget-normalization` | Token budget | Normalizes input/output token budgets before request shaping. |
| `cost-budget-ceiling` | Cost ceiling | Records finite cloud cost budget and estimated spend. |
| `latency-timeout-policy` | Latency and timeout | Requires latency budget and request timeout. |
| `retry-and-circuit-breaker-policy` | Retry control | Bounds retries and uses circuit breaker state. |
| `streaming-idle-timeout` | Streaming budget | Adds idle timeout to streaming work. |
| `cancellation-propagation` | Cancellation | Propagates user aborts through provider, stream, tool, and fallback work. |
| `visible-fallback-with-budget-preservation` | Fallback | Keeps fallback visible and budget-preserving or budget-reducing. |
| `local-inference-resource-budget` | Local resource | Tracks memory and thermal budgets before local inference expansion. |
| `tool-loop-budget-boundary` | Tool loop | Bounds tool calls, timeout, tokens, and cost. |
| `observability-budget-accounting` | Diagnostics | Records budget ledger fields and audit events. |
| `blocked-unbounded-retries` | Retry block | Blocks unbounded retry loops and missing circuit breaker policy. |
| `blocked-missing-timeout` | Timeout block | Blocks provider or stream work without timeout and latency budget. |
| `blocked-fallback-budget-escalation` | Fallback block | Blocks silent token, cost, latency, or reasoning budget escalation. |
| `blocked-no-cancellation` | Cancellation block | Blocks long-running work without cancellation propagation. |
| `blocked-unmetered-tool-loop` | Tool-loop block | Blocks missing tool-call limits or exceeded tool-call estimates. |
| `blocked-unbounded-local-resource-use` | Local resource block | Blocks missing thermal policy or memory estimates above budget. |

## Diagnostic Contract

Each diagnostic records:

- surface, readiness, and description,
- budget kinds covered by the fixture,
- input/output token budget and estimates,
- cost budget and estimate,
- latency budget, observed latency, and timeout,
- retry limit, circuit breaker, stream idle timeout, and cancellation propagation,
- fallback budget policy and visibility,
- tool-call limit and estimate,
- local memory budget, local memory estimate, and thermal policy,
- budget ledger status, audit event, local/offline status, and failure codes.

## Adoption Rule

Before adding broader reasoning retries, provider fallback, long streams, realtime media, local inference, tool loops, background jobs, or external workers, extend this gate with a fixture for the budget path. Any path without finite token, cost, latency, timeout, retry, stream idle, cancellation, fallback, tool-call, memory, thermal, budget ledger, and audit behavior must stay blocked or degraded with a visible reason.
