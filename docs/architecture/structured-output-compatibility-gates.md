# Structured Output Compatibility Gates

## Scope

Structured output is a core direction for reliable agents, typed tools, workflow definitions, and post-processing. IsleMind should prefer provider-native schema controls when they are source-backed and should avoid relying on prompt-only JSON instructions as a capability claim.

Local gate:

- Schema: `islemind.structured-output-compatibility-eval.v1`
- Service: `src/services/structuredOutputCompatibilityEvaluation.ts`
- Script: `scripts/structured-output-compatibility-tests.js`
- Package entry: `bun run test:structured-output-compatibility`

Reference technologies:

- Instructor-style typed response contracts
- Outlines / constrained decoding
- JSON schema structured output
- Provider-native tool schemas
- Provider-native response schemas

These are compatibility patterns, not required runtime dependencies.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `openai-responses-text-format` | Responses API typed output | Uses `text.format` style structured output with strict schema and required-field validation. |
| `openai-chat-response-format` | Chat Completions JSON schema | Uses OpenAI-compatible `response_format` with strict schema where supported. |
| `anthropic-tool-schema` | Anthropic typed-output through tool schema | Uses a synthetic tool schema for typed output without conflating it with arbitrary tool execution. |
| `google-response-schema` | Gemini response schema | Uses `responseSchema`-style typed output for generateContent. |
| `openrouter-model-gated-schema` | Relay/model-metadata gate | Sends schema controls only when model metadata declares support. |
| `localai-grammar-adapter-required` | Grammar-backed structured output | Blocks app request controls until a LocalAI grammar adapter exists. |
| `generic-compatible-no-metadata` | Unknown OpenAI-compatible provider | Blocks schema controls when provider/model metadata does not prove support. |
| `malformed-schema-refusal` | Invalid schema | Blocks request shaping before provider calls. |
| `tool-and-structured-output-coexistence` | Tools plus typed output | Keeps provider tools and structured output as separate request surfaces. |
| `json-object-fallback-repair` | JSON object fallback | Allows parser-validated fallback, but does not claim strict JSON schema. |

## Diagnostic Contract

Each diagnostic records:

- provider family and protocol,
- docs source,
- documented and selected request shape,
- readiness,
- strict-schema status,
- app request-control status,
- model-metadata support,
- adapter requirement,
- tool declaration count and schema validity,
- parser result and required-field coverage,
- failure codes.

## Adoption Rule

Before widening structured-output request controls, provider-native tool schemas, typed workflow outputs, or JSON repair behavior, this gate must pass and be extended for the new request shape. Unknown OpenAI-compatible providers must stay blocked unless model metadata, docs, or explicit user capability declarations prove structured-output support.
