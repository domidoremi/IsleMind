# Provider Protocol Compatibility Gates

## Scope

Provider protocol compatibility is the boundary between IsleMind runtime decisions and upstream AI provider behavior. This gate keeps official providers, OpenAI-compatible relays, cloud-hosted providers, local runtimes, Responses, Chat Completions, Anthropic Messages, Gemini generateContent, SSE, WebSocket, signed hosted requests, model-list behavior, and provider-state replay explicit and diagnosable.

Local gate:

- Schema: `islemind.provider-protocol-compatibility-eval.v1`
- Service: `src/services/providerProtocolCompatibilityEvaluation.ts`
- Script: `scripts/provider-protocol-compatibility-tests.js`
- Package entry: `bun run test:provider-protocol-compatibility`

Architecture stance:

- Provider routes must declare protocol family, endpoint family, auth shape, transport, request conformance, capability evidence, model-list behavior, timeout, error mapping, and redaction.
- OpenAI-compatible does not mean every OpenAI feature is safe to send. Optional features require contract evidence, remote model metadata, manual declaration, or live smoke evidence.
- Cloud-hosted providers must preserve region, resource, deployment, tenant, and account-scope semantics.
- Local runtimes require LAN opt-in, manual fallback, timeout policy, and mobile loopback awareness.
- Responses WebSocket is selected only when provider contract, request shape, app capability, and runtime support all agree; otherwise fallback to HTTP/SSE must be visible.
- Response ids, cache ids, and provider-native tool replay state remain scoped to the same provider route.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `openai-responses-http-sse-route` | Official Responses route | Uses `/v1/responses`, HTTP/SSE, provider identity, and same-provider state. |
| `openai-chat-completions-compat-route` | Chat compatibility route | Keeps Chat Completions explicit instead of silently substituting Responses. |
| `anthropic-messages-sse-route` | Anthropic route | Uses native Messages shape, auth, streaming, and error mapping. |
| `google-generate-content-sse-route` | Gemini route | Uses model-path generateContent routing and provider-specific body shaping. |
| `openai-compatible-relay-declared-capabilities` | Relay route | Requires declared endpoint/model capability evidence and avoids upstream capability flattening. |
| `azure-openai-v1-hosted-route` | Hosted OpenAI-compatible route | Keeps resource, deployment, region, auth, and hosted diagnostics explicit. |
| `bedrock-runtime-signed-invoke-route` | Hosted native route | Requires signed request preparation and degraded state until streaming/Converse are proven. |
| `local-runtime-openai-compatible-lan-route` | Local runtime route | Requires LAN opt-in, manual fallback, timeout, and local-runtime diagnostics. |
| `responses-websocket-contract-route` | WebSocket success path | Requires Responses contract and runtime WebSocket support. |
| `responses-websocket-visible-http-fallback` | WebSocket fallback | Falls back visibly to HTTP/SSE when WebSocket runtime is unavailable. |
| `model-list-suppression-manual-fallback` | Model-list control | Suppresses unsafe `/models` assumptions and uses manual or metadata fallback. |
| `same-provider-state-continuation` | Provider state | Keeps response/cache/tool replay state within the same provider route. |
| `blocked-generic-openai-compatible-overclaim` | Generic overclaim block | Blocks optional capabilities on unknown compatible endpoints without evidence. |
| `blocked-hosted-route-missing-region` | Hosted route block | Blocks cloud-hosted providers without region/resource/deployment scope. |
| `blocked-cross-provider-state-replay` | Replay block | Blocks response/cache/tool replay across providers. |
| `blocked-websocket-without-contract-or-runtime` | WebSocket block | Blocks WebSocket when contract or runtime support is missing. |

## Diagnostic Contract

Each diagnostic records:

- protocol family, hosting profile, endpoint family, readiness, and description,
- docs mapping, provider identity, protocol mapping, endpoint resolution, auth mapping, region/resource scope, request conformance, capability evidence, generic-capability flattening status, Responses/Chat permissions, model-list policy, manual fallback, transport, WebSocket contract/runtime status, fallback visibility, live-smoke plan, same-provider state, local-network opt-in, timeout policy, error mapping, redaction, signed-request status, network-call status, and failure codes.

## Adoption Rule

Before adding provider families, hosted routes, relays, aggregators, local runtimes, WebSocket transports, Responses paths, model-list sync, or provider-native state continuation, extend this gate with a fixture for the new path. Any route without protocol evidence, endpoint/auth semantics, request conformance, capability evidence, timeout, error mapping, redaction, transport fallback, and provider-state isolation must stay blocked or degraded with a visible reason.
