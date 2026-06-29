# Provider Model Lifecycle Compatibility Gates

## Scope

Provider model lifecycle is the boundary between provider discovery, model selection, aliases, deprecations, hosted deployment identity, and model capability admission. This gate keeps model catalogs accurate without assuming every provider, relay, hosted route, or local runtime exposes the same `/models` contract.

Local gate:

- Schema: `islemind.provider-model-lifecycle-compatibility-eval.v1`
- Service: `src/services/providerModelLifecycleCompatibilityEvaluation.ts`
- Script: `scripts/provider-model-lifecycle-compatibility-tests.js`
- Package entry: `bun run test:provider-model-lifecycle-compatibility`

Architecture stance:

- `/models` is provider-specific capability evidence, not a universal OpenAI-compatible invariant.
- Providers with unsupported or unreliable model-list endpoints must suppress sync and use explicit manual fallback.
- Aliases resolve to canonical same-provider model ids before capability lookup, routing, diagnostics, request shaping, cache reuse, and compact state reuse.
- Deprecated model slugs need visible replacement mapping. Deprecated models without replacements stay blocked.
- Remote model metadata can admit advanced capabilities only when scoped to the selected provider, route, model id, and hosted region/deployment identity.
- Private or custom endpoint model imports require explicit user declaration before model ids or capabilities are admitted.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `official-model-list-sync-verified-metadata` | Official model sync | Allows scoped `/models` sync only with provider identity, fresh metadata, and model capability evidence. |
| `model-list-suppression-manual-fallback` | Suppressed model-list route | Suppresses unsupported sync and uses manual fallback with visible explanation. |
| `alias-resolution-canonical-model` | Alias lifecycle | Resolves user-facing aliases to canonical same-provider model ids before capability lookup. |
| `deprecation-replacement-mapping` | Deprecation lifecycle | Keeps deprecated slugs degraded only when replacement mapping is recorded. |
| `remote-metadata-capability-admission` | Aggregator metadata | Admits tools, vision, files, schema, search, and token capabilities only from scoped metadata. |
| `relay-manual-model-declaration` | Relay model declaration | Keeps relays degraded until model ids and capabilities are declared manually. |
| `local-runtime-manual-model-fallback` | Local runtime fallback | Uses manual model fallback and local-only capability policy for LAN or on-device runtimes. |
| `hosted-deployment-scoped-model-identity` | Hosted model identity | Binds model identity to region, resource, tenant, or deployment scope. |
| `blocked-universal-model-list-assumption` | Universal `/models` block | Blocks unknown compatible endpoints that assume a universal model-list contract. |
| `blocked-stale-alias-mapping` | Stale alias block | Blocks stale aliases from driving routing or capability admission. |
| `blocked-deprecated-model-without-replacement` | Deprecated model block | Blocks deprecated models without replacement mapping. |
| `blocked-capability-flattening-from-metadata` | Capability flattening block | Blocks provider-level optional features from being flattened across every model. |
| `blocked-cross-provider-alias-state-replay` | Cross-provider state block | Blocks aliases, response ids, cache state, and compact state across provider families. |
| `blocked-private-custom-endpoint-import` | Private import block | Blocks private/custom endpoint model imports without explicit user declaration. |

## Diagnostic Contract

Each diagnostic records:

- source, hosting profile, provider family, model id, readiness, and description,
- docs and provider identity mapping,
- model-list policy, endpoint scope, remote metadata verification, and metadata freshness,
- manual model fallback and manual declaration status,
- alias requirement, alias resolution, canonical model id, and alias freshness,
- deprecation status, deprecation mapping, and replacement model id,
- required and admitted model capabilities,
- metadata capability scoping, region/deployment scope, same-provider alias state,
- private endpoint and user declaration status,
- downgrade visibility, audit event, local/offline status, missing capabilities, and failure codes.

## Adoption Rule

Before adding a provider, hosted route, relay, local runtime, model alias, model-list sync path, deprecation rule, model capability inference, or custom endpoint import, extend this gate with a fixture for the lifecycle path. Any path without provider identity, model-list policy, fresh metadata or manual declaration, alias/deprecation safety, capability scoping, hosted identity scope, visible downgrade, audit, and same-provider state isolation must stay blocked or degraded with a visible reason.
