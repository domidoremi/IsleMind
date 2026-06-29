# Reasoning Runtime Compatibility Gates

## Scope

Reasoning and test-time compute are useful only when they are explicit, bounded, observable, and provider-aware. This gate prevents IsleMind from treating prompt-only chain-of-thought text, unsupported provider parameters, or unbounded retry loops as production reasoning controls.

Local gate:

- Schema: `islemind.reasoning-runtime-compatibility-eval.v1`
- Service: `src/services/reasoningRuntimeCompatibilityEvaluation.ts`
- Script: `scripts/reasoning-runtime-compatibility-tests.js`
- Package entry: `bun run test:reasoning-runtime-compatibility`

Architecture stance:

- Provider reasoning controls must be sent only when provider protocol, model metadata, and compatibility evidence support the request shape.
- Response-side reasoning traces may be parsed as summaries, but they do not imply request-side control support.
- Test-time compute loops must have max steps, retry limits, timeout, token budget, cost budget, cancellation, visible summaries, and eval outcomes.
- Tool-using verification must cite tool evidence instead of trusting model text.
- Hidden chain-of-thought and raw thinking payloads must not be stored or exported.
- Fallback must not silently increase reasoning effort, retries, token budgets, or cost.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `openai-responses-reasoning-effort` | OpenAI Responses reasoning controls | Sends explicit provider-native reasoning effort only when model metadata supports it and records bounded summary traces. |
| `anthropic-thinking-budget` | Anthropic extended thinking | Uses provider-native thinking budget controls without prompt-only reasoning capture. |
| `google-thinking-budget` | Gemini thinking controls | Uses provider-specific thinking budget semantics instead of generic reasoning fields. |
| `provider-response-reasoning-trace` | Response-side reasoning traces | Allows trace-only summaries while refusing to claim request-side control. |
| `bounded-verification-loop` | Test-time compute loop | Requires max steps, retry limit, timeout, token/cost budgets, cancellation, visible summary, and eval outcome. |
| `tool-result-self-check-loop` | Tool evidence verification | Requires tool evidence and eval outcome before accepting tool-dependent answers. |
| `unsupported-provider-effort-blocked` | Generic provider overclaim | Blocks reasoning effort controls without provider/model compatibility evidence. |
| `budget-escalation-blocked` | Unbounded compute escalation | Blocks silent fallback escalation, missing budgets, unbounded retries, and missing eval outcome. |
| `hidden-reasoning-export-blocked` | Hidden reasoning leakage | Blocks storing or exporting hidden chain-of-thought or raw thinking payloads. |
| `prompt-only-cot-blocked` | Prompt-only reasoning | Blocks prompt instructions that attempt to substitute for a typed reasoning control plane. |

## Diagnostic Contract

Each diagnostic records:

- provider family, runtime surface, docs, and request shape,
- requested and effective reasoning effort,
- model-metadata support and app request-control status,
- readiness: `ready`, `trace-only`, or `blocked`,
- max steps, retry limit, timeout, token budget, cost budget, cancellation, verifier requirement, eval-outcome requirement, tool-evidence requirement, and fallback escalation policy,
- trace summary status, hidden-chain leakage status, eval outcome status, tool evidence status, and failure codes.

## Adoption Rule

Before adding new reasoning controls, verifier loops, retry policies, model routers, tool self-checks, or trace exports, extend this gate with a fixture for the new path. Any path without provider/model evidence, bounded test-time compute policy, cancellation, visible summary, eval outcome when required, and hidden-reasoning redaction must stay blocked or trace-only.
