# Provider State Isolation Compatibility Gates

## Scope

Provider state isolation is the boundary between provider-native continuation features and IsleMind runtime routing. This gate keeps session affinity, credential-group bindings, Responses `previous_response_id`, compact-state rows, provider-native tool replay, session leases, fallback, and route diagnostics scoped before IsleMind widens Responses, cache, tool replay, hosted providers, relays, or model routing.

## Default Behavior

- Session affinity keys must include provider id, requested model, conversation id, and session id.
- Credential-group bindings must carry finite TTL, expiry pruning, bounded binding count, and health-triggered invalidation.
- Remote compact state must be looked up by conversation id, provider id, model, active status, and expiry.
- Responses continuation and provider-native tool replay state must stay same-provider and same-model unless the state is explicitly reset.
- Runtime fallback must use same-provider state policy or visibly reset provider-native state before moving to a different route.
- Session concurrency leases must be scoped by provider, model, conversation, and session.
- Diagnostics must emit scoped, redacted state events and route snapshots instead of raw provider state payloads.

## Evaluation Schema

The local gate is `islemind.provider-state-isolation-compatibility-eval.v1`.

Each diagnostic records:

- `fixtureId`
- `surface`
- `readiness`
- provider, model, conversation, session, and credential-group scope
- TTL, expiry pruning, and max binding policy
- health invalidation
- same-provider replay policy
- cross-provider and cross-model replay blocking
- previous-response, compact-state, and provider-tool replay match status
- fallback state policy
- raw-state export status
- redaction and audit-event status
- failure codes

## Required Fixtures

| Fixture | Required behavior |
| --- | --- |
| `session-affinity-key-provider-model-conversation` | Session affinity keys are scoped by provider, model, conversation, and session. |
| `credential-group-binding-ttl` | Credential-group bindings use finite TTL, pruning, health invalidation, and binding caps. |
| `responses-previous-response-provider-scope` | Responses continuation state remains provider, model, conversation, and response scoped. |
| `compact-state-provider-model-scope` | Compact-state lookup requires conversation, provider, model, active status, and expiry checks. |
| `provider-tool-replay-same-provider` | Provider-native tool replay ids stay bound to current provider state. |
| `session-lease-provider-model-session-scope` | Session concurrency leases include provider, model, conversation, and session in the lease key. |
| `fallback-same-provider-state-policy` | Fallback preserves same-provider state policy or performs visible state reset. |
| `diagnostics-redacted-state-events` | Runtime diagnostics emit scoped state events with redaction metadata. |
| `blocked-cross-provider-response-id-replay` | Responses ids cannot replay across provider identity. |
| `blocked-cross-model-cache-continuation` | Cache or compact continuation cannot replay across model scope. |
| `blocked-stale-session-affinity-binding` | Expired, disabled, cooling-down, or ineligible bindings fail closed. |
| `blocked-tool-replay-id-mismatch` | Provider-native tool replay ids cannot be reused after state mismatch. |
| `blocked-raw-state-export` | Raw response ids, cache items, and provider replay payloads are not exported or logged. |
| `blocked-unbounded-session-state` | Unbounded affinity binding counts or TTLs fail closed. |

## Acceptance Criteria

- `node scripts/provider-state-isolation-compatibility-tests.js` passes.
- `bun run test:provider-state-isolation-compatibility` passes.
- The evaluation output includes every required fixture id and covers session-affinity, responses-state, compact-state, tool-replay, session-lease, fallback, diagnostics, and blocked surfaces.
- All blocked fixtures produce expected failure codes before provider-native state can be replayed.
