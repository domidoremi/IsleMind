# Provider Fallback Candidate Compatibility Gates

## Scope

Provider fallback candidates are the route inventory used before failover policy selects a replacement provider/model/credential group. This gate keeps candidate generation bounded, capability-aware, credential-scoped, health-aware, and non-secret before IsleMind expands quota-aware routing, hosted compatibility chains, automatic repair, or cross-provider fallback.

## Default Behavior

- Fallback candidate builds use the versioned `islemind.provider-fallback-candidate-build.v1` schema.
- Candidate discovery merges provider models, manual models, model configs, model availability, and aliases, then caps expansion per provider.
- Disabled providers and disabled credentials are excluded unless explicitly requested.
- Providers with no candidate models, no enabled credentials, deprecated models, missing credentials, credential-model mismatches, and capability mismatches produce visible rejection reasons.
- Capability checks go through provider compatibility contracts for vision, files, audio, reasoning, streaming, tools, and native search.
- Credential groups can use explicit models or upstream model aliases, but unavailable models are rejected.
- Provider health annotations mark unhealthy or cooldown candidates before failover selection.
- Candidate output is deduplicated by provider, model, credential group, and region.
- Candidate evidence records provider count, discovered model count, credential-group count, and required capabilities.
- Candidate results must omit API keys, bearer tokens, raw request bodies, prompt text, and provider response content.

## Required Fixtures

| Fixture | Required behavior |
| --- | --- |
| Mixed provider set | Produces candidates for enabled, capable, credentialed providers and visible rejection reasons for disabled, empty, deprecated, missing-credential, limited-credential, and capability-mismatch providers. |
| Alias credential | Allows a credential group when available models include the upstream alias target. |
| Health annotation | Carries cooldown/unhealthy state and health score into generated candidates. |
| Model cap | Honors `maxModelsPerProvider` for model discovery and candidate output. |
| Default credential | Synthesizes a `default` credential group only when provider-level API key exists. |
| Explicit disabled inclusion | Includes disabled providers and credentials only when both opt-in flags are set. |
| Redaction | Candidate results omit provider and credential-group secrets. |

## Acceptance Criteria

- `node scripts/provider-fallback-candidate-compatibility-tests.js` passes.
- `bun run test:provider-fallback-candidate-compatibility` passes.
- The evaluation covers model discovery, caps, credential scoping, alias availability, capability gates, health annotations, rejection reasons, dedupe source guardrails, and redaction.
- Candidate expansion remains bounded and cannot silently bypass provider compatibility contracts or credential model scope.
