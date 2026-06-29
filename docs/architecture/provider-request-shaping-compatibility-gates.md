# Provider Request Shaping Compatibility Gates

## Scope

Provider request shaping is the boundary between capability routing and the concrete JSON body sent to an upstream model. This gate keeps reasoning, tools, structured output, multimodal input, native search, token limits, cache/compact state, relay declarations, privacy policy, diagnostics, and fallback behavior explicit before IsleMind sends provider-specific fields.

Local gate:

- Schema: `islemind.provider-request-shaping-compatibility-eval.v1`
- Service: `src/services/providerRequestShapingCompatibilityEvaluation.ts`
- Script: `scripts/provider-request-shaping-compatibility-tests.js`
- Package entry: `bun run test:provider-request-shaping-compatibility`

Architecture stance:

- Provider protocol selection is not enough. The request body must be shaped by provider family, model metadata, declared capability, privacy policy, token budget, and fallback behavior.
- OpenAI-compatible endpoints must not receive optional OpenAI fields unless provider contract evidence, remote model metadata, or explicit manual declaration allows them.
- Unsupported reasoning, tool, structured-output, search, multimodal, cache, or compact fields must be removed with visible downgrade, or blocked before the request leaves the local control plane.
- Token parameters must normalize to each provider shape, such as `max_tokens`, `max_output_tokens`, `max_completion_tokens`, or `generationConfig.maxOutputTokens`.
- Cache ids, previous response ids, and compact state stay scoped to the same provider/model route.
- Private local-only payloads cannot be shaped for cloud routes without explicit redaction and policy.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `openai-responses-reasoning-text-format` | Responses reasoning and typed output | Emits native `reasoning`, `text.format`, and `max_output_tokens` only with model evidence. |
| `anthropic-thinking-tool-shape` | Anthropic thinking and tools | Emits `thinking`, tool schemas, and `max_tokens` without OpenAI-only fields. |
| `gemini-multimodal-tool-schema` | Gemini multimodal body | Emits `contents`, `function_declarations`, response schema, multimodal parts, and `generationConfig.maxOutputTokens`. |
| `openai-chat-function-tool-shape` | Chat Completions tools | Keeps `tools`, `tool_choice`, and `max_completion_tokens` explicit. |
| `structured-output-model-metadata-shape` | Aggregator schema control | Emits `response_format` only when model metadata proves support. |
| `native-search-tool-shape` | Native search | Emits provider-specific search tools only on documented routes. |
| `provider-cache-remote-compact-shape` | Cache and remote compact | Requires same-provider cache/compact scope, redaction, and audit. |
| `local-runtime-token-parameter-shape` | Local runtime shape | Uses conservative OpenAI-compatible token fields and local-only policy. |
| `token-max-output-normalization` | Token clamp | Clamps oversized max-output requests and records the visible adjustment. |
| `relay-manual-capability-declaration` | Relay optional fields | Allows tools only after manual declaration or metadata evidence. |
| `visible-downgrade-unsupported-search` | Safe downgrade | Removes unsupported native search and falls back visibly to plain chat. |
| `blocked-unsupported-reasoning-field` | Reasoning block | Blocks unverified reasoning fields. |
| `blocked-unsupported-tool-field` | Tool block | Blocks unsupported or malformed tool fields. |
| `blocked-unsupported-multimodal-field` | Multimodal block | Blocks image/file/audio fields without metadata support. |
| `blocked-unsupported-structured-output-field` | Schema block | Blocks unsupported or malformed structured-output fields. |
| `blocked-generic-compatible-overclaim` | Generic compatible block | Blocks optional OpenAI fields on unknown compatible endpoints. |
| `blocked-private-data-cloud-route` | Privacy block | Blocks local-only private payloads from cloud shaping without redaction. |
| `blocked-token-budget-overrun` | Token block | Blocks oversized token fields when normalization fails. |
| `blocked-cross-provider-cache-state` | Provider-state block | Blocks cache/compact state reuse across providers. |

## Diagnostic Contract

Each diagnostic records:

- request shape, hosting profile, readiness, and description,
- docs/protocol/endpoint mapping, capability evidence, model metadata, manual declaration, generic-overclaim status,
- required/supported capabilities, requested/emitted/removed/adjusted fields,
- max-output field, requested/limit token counts, token-normalization status,
- fallback requirement, fallback shape, downgrade visibility,
- privacy mode, private-data flag, redaction status,
- cache scope, same-provider state, schema validity, multimodal payload bounds,
- diagnostics redaction, audit event, local/offline status, unsupported emitted fields, missing capabilities, and failure codes.

## Adoption Rule

Before adding provider-specific fields, new model metadata branches, relay capability switches, native search, reasoning controls, tool schemas, multimodal inputs, cache/compact state, token parameter variants, or privacy-sensitive request routes, extend this gate with a fixture for the new body shape. Any path without capability evidence, request-field validation, token normalization, visible fallback, redaction, audit, and provider-state isolation must stay blocked or degraded with a visible reason.
