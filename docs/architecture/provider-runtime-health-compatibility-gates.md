# Provider Runtime Health Compatibility Gates

## Scope

Provider runtime health is the local memory that keeps retries, cooldown, circuit opening, credential-group failover, route snapshots, and diagnostics from treating every provider route as equally healthy. This gate keeps health records scoped, bounded, non-secret, and recoverable before IsleMind expands hosted-provider chains, quota-aware routing, or automatic provider repair.

## Default Behavior

- Runtime health views use the versioned `islemind.provider-runtime-health-view.v1` schema.
- Provider health snapshots use storage version `1` under `@islemind/provider-health`.
- Runtime health routes preserve provider id, model, credential group, region, and required fallback capabilities.
- Successful provider responses record healthy state, success count, latency, timestamp, and clear cooldown/circuit state.
- Failed provider responses classify status, message, and explicit failure signals into bounded triggers such as `rate_limited`, `server_error`, `model_unavailable`, and `credential_unhealthy`.
- Rate-limit and server-error failures create finite cooldowns; repeated failures open a finite circuit.
- Expired cooldown or circuit states degrade instead of remaining active forever.
- Snapshot normalization drops invalid or old records, caps record count, clamps counters, and supports provider-scoped cleanup.
- Health telemetry must not serialize API keys, bearer tokens, raw request bodies, prompts, or provider response content.
- Health telemetry failures must not block provider responses.

## Required Fixtures

| Fixture | Required behavior |
| --- | --- |
| Route construction | Provider id, model, credential group, region, and capability requirements remain stable and deterministic. |
| Success record | Records healthy status, success count, latency, timestamp, and clears active cooldown/circuit state. |
| Rate-limit failure | Classifies 429/quota text as `rate_limited` and records a finite retry-after cooldown. |
| Circuit failure | Repeated retryable failures open a finite circuit and later degrade after expiry. |
| Recovery success | Later success clears cooldown/circuit expiry and resets consecutive failures. |
| Snapshot normalization | Invalid, stale, and excess records are removed; status and counters are sanitized. |
| Redaction | Provider-health snapshots omit API keys, authorization tokens, raw request bodies, prompts, and response content. |

## Acceptance Criteria

- `node scripts/provider-runtime-health-compatibility-tests.js` passes.
- `bun run test:provider-runtime-health-compatibility` passes.
- The evaluation covers route construction, success, rate-limit cooldown, circuit opening, expiry, recovery, snapshot normalization, deterministic keys, source guardrails, and redaction.
- Provider-health expansion remains bounded and isolated from provider execution success or failure.
