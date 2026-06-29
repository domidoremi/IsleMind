# Credential Governance Compatibility Gates

## Scope

Credential governance is the boundary between provider setup and any runtime path that can authenticate to an external service. This gate keeps provider keys, credential groups, hosted-provider auth material, proxy endpoints, observability sinks, portable restore, and runtime diagnostics scoped before IsleMind widens provider families, hosted routes, realtime transports, local workers, or external telemetry.

## Default Behavior

- Provider API keys and credential-group keys must persist through secure storage helpers, not through provider records, settings records, runtime logs, runtime events, or portable exports.
- Credential selection must stay scoped to provider id, credential group id, model availability, health state, cooldown or circuit state, hosted auth route, region, resource, and deployment identity.
- Portable full restore may import provider secrets only by moving them into secure storage before sanitized provider records are saved.
- Observability sink export must require secure API-key storage, explicit user opt-in, and workspace consent before external export is allowed.
- Proxy and endpoint URLs must reject userinfo credentials and runtime diagnostics must redact sensitive query parameters, authorization headers, credential assignments, and payload summaries.
- Destructive reset must clear known provider, credential-group, search-provider, and observability secure keys.

## Evaluation Schema

The local gate is `islemind.credential-governance-compatibility-eval.v1`.

Each diagnostic records:

- `fixtureId`
- `surface`
- `readiness`
- `storageBackend`
- provider and credential-group scope
- model-scoped credential selection
- credential health routing
- hosted auth, region, resource, and deployment scope
- observability API-key storage, opt-in, and consent
- proxy URL and query credential sanitization
- runtime log and runtime event redaction
- portable export secret elision
- secure restore behavior
- destructive reset cleanup
- cross-provider credential replay blocking
- failure codes

## Required Fixtures

| Fixture | Required behavior |
| --- | --- |
| `native-secure-provider-key-storage` | Provider keys are stored through native secure storage and persisted provider/settings records keep only configured state. |
| `credential-group-secure-storage` | Credential-group keys are stored under provider and group scoped secure keys. |
| `model-scoped-credential-selection` | Runtime credential selection respects model availability, enabled state, and excluded groups. |
| `credential-health-routing` | Failure count, last-use state, cooldown, and circuit state stay scoped to credential routing. |
| `imported-credential-secure-restore` | Full restore imports keys into secure storage and saves sanitized provider records. |
| `hosted-auth-scope` | Hosted auth remains explicit about provider identity, auth mode, region, resource, and deployment scope. |
| `observability-sink-secure-opt-in` | Observability sink API keys are secure and external export requires opt-in plus workspace consent. |
| `proxy-url-credential-sanitization` | Proxy and endpoint URLs block userinfo credentials and redact sensitive query parameters. |
| `runtime-diagnostics-redaction` | Logs and runtime events redact authorization headers, API keys, credential assignments, query secrets, and payload summaries. |
| `portable-export-secret-elision` | Portable export excludes provider keys, credential-group keys, and observability sink keys. |
| `destructive-reset-secret-cleanup` | Reset clears known provider, group, search-provider, and observability secure keys. |
| `blocked-plaintext-provider-key` | Plaintext provider keys in persisted settings or provider records fail closed. |
| `blocked-credential-in-url` | Credentials in URL userinfo or query parameters fail closed. |
| `blocked-runtime-diagnostics-secret-leak` | Runtime diagnostics that would persist raw credential data fail closed. |
| `blocked-cross-provider-credential-replay` | Credentials cannot replay across provider ids, hosted routes, or credential groups. |
| `blocked-observability-export-without-consent` | External observability export without secure key storage, user opt-in, and workspace consent fails closed. |

## Acceptance Criteria

- `node scripts/credential-governance-compatibility-tests.js` passes.
- `bun run test:credential-governance-compatibility` passes.
- The evaluation output includes every required fixture id and covers provider-key, credential-group, provider-routing, hosted-auth, observability, proxy, runtime-diagnostics, export-restore, data-reset, and blocked surfaces.
- All blocked fixtures produce the expected failure codes before any network call is allowed by the control plane.
