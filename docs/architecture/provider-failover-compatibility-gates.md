# Provider Failover Compatibility Gates

## Scope

Provider failover is the local policy boundary for moving a request away from the original provider route. This gate keeps failover explicit, capability-aware, cost-aware, region-aware, health-aware, and non-secret before IsleMind expands quota-aware routing, hosted compatibility chains, automatic repair, or cross-provider fallback.

## Default Behavior

- Failover decisions use the versioned `islemind.provider-failover-decision.v1` schema.
- Retryable triggers are finite: timeout, network error, rate limit, server error, model unavailable, overloaded, and credential unhealthy.
- Payload errors, safety refusals, unknown errors, and already-started streams are not retryable by default.
- Policy `off`, explicit model locks, unsafe stream-started retry, missing candidates, and cross-provider confirmation requirements fail closed.
- Candidates are rejected when they repeat the same route, are unhealthy, are in cooldown, are not approved, cross provider without policy, miss required capabilities, change protected region, exceed max cost, or increase cost without approval.
- Candidate selection prefers same-provider fallback before cross-provider fallback when all other constraints pass.
- Runtime fallback capability requirements are derived from reasoning, tools, structured output, native search, and sendable attachment modalities.
- Retry-after cooldowns are finite for rate-limit and server-error failures.
- Decisions and route summaries must omit API keys, bearer tokens, raw request bodies, prompt text, and provider response content.

## Required Fixtures

| Fixture | Required behavior |
| --- | --- |
| Failure classification | HTTP status, explicit flags, error code, and error text map to finite retryable and non-retryable triggers. |
| Candidate selection | Same-route, cooldown, unhealthy, capability mismatch, protected-region change, and cost-tier overage candidates are rejected. |
| Policy blocks | Policy-off, non-retryable trigger, stream-started retry, explicit model lock, and cross-provider ask mode block failover. |
| Capability requirements | Runtime fallback requires text, reasoning, tools, structured output, native search, image, and file capabilities only when the request needs them. |
| Retry-after policy | Rate-limit and server-error failures use finite cooldowns; payload errors do not. |
| Redaction | Failover decisions and route summaries omit provider secrets and raw payload data. |

## Acceptance Criteria

- `node scripts/provider-failover-compatibility-tests.js` passes.
- `bun run test:provider-failover-compatibility` passes.
- The evaluation covers failure classification, policy blocking, candidate rejection, selected fallback, cross-provider confirmation, capability requirements, retry-after policy, provider resolution, source guardrails, and redaction.
- Failover expansion stays explicit and does not silently downgrade capabilities, cross provider without policy, or serialize secrets.
