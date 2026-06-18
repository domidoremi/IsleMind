# Long-Context Compression And Provider Compatibility

## Snapshot

- Date: 2026-06-18
- Scope: long-context compression UX, local compression quality, Responses and relay compatibility, runtime visibility, and provider capability boundary clarity
- Verification baseline: `bun run type-check`, `bun run test:provider-intelligence`, `node scripts/provider-intelligence-tests.js --focus=provider-presets`, `node scripts/provider-intelligence-tests.js context-compression-v2`, `node scripts/provider-intelligence-tests.js provider-request-routing`

## Current State

### In-chat compression UX

- Chat now exposes compression activity inside the conversation surface instead of only through hidden traces.
- `src/components/chat/ChatWorkspace.tsx` shows:
  - an in-chat compression banner
  - a deduplicated toast sourced from trace metadata
- The banner already distinguishes:
  - remote compact
  - local summary compression
  - single-message truncation
- Banner and toast copy are localized and now include the effective reason when trace metadata exposes it, including:
  - remote compact active
  - remote compact below threshold
  - provider capability missing
  - single-message truncation

### Local compression quality

- `src/services/contextPacker.ts` now prioritizes structured summary sections:
  - constraints
  - decisions
  - failures
  - actions
  - references
  - recent
- Single oversized-message handling preserves head and tail content more deterministically.
- Compression metadata schema v2 remains the shared surface for UI and diagnostics.

### Provider capability routing

- OpenAI Responses routing already uses:
  - `previous_response_id`
  - `context_management` with compaction
- IsleMind now separates:
  - local auto-compact ratio threshold
  - official Responses `context_management.compact_threshold` token threshold
- OpenAI-compatible relays can now route through Responses when they explicitly declare `capabilities.responsesApi === true`.
- This improves the compatibility path for:
  - official provider -> relay provider -> IsleMind
  - provider presets with partial OpenAI compatibility but explicit Responses support
- Azure OpenAI v1 resources are now treated as a cloud-hosted OpenAI-compatible shape when the provider base URL follows `{resource}.openai.azure.com/openai/v1` or `{resource}.services.ai.azure.com/openai/v1`:
  - chat routes to `/openai/v1/chat/completions`
  - Responses routes to `/openai/v1/responses`
  - model sync routes to `/openai/v1/models`
  - API-key authentication uses the Azure `api-key` header rather than OpenAI bearer auth
- AWS Bedrock and Vertex AI are now explicit hosted provider families rather than accidental generic-compatible endpoints:
  - Bedrock Mantle OpenAI-compatible hosts such as `bedrock-mantle.{region}.api.aws/v1` are detected as `aws-bedrock` and can route chat, Responses, and model-list calls with Bedrock API-key bearer auth.
  - Bedrock Runtime hosts such as `bedrock-runtime.{region}.amazonaws.com` are detected as `aws-bedrock`. Non-streaming Anthropic-style model tests can now prepare signed SigV4 `InvokeModel` requests when the API key field contains JSON or env-style AWS credentials.
  - Vertex hosts are detected as `vertex-ai`. The OpenAI-compatible hosted endpoint under `/v1/projects/{project}/locations/{location}/endpoints/openapi` can route chat/model-list calls with a Google Cloud access-token bearer value.
  - Native Vertex Gemini REST paths remain fail-closed until project/location/publisher/model-aware native routing is implemented.
  - Runtime diagnostics count unsupported hosted paths as hosted gaps, so users see planned support instead of a misleading broken request.

### Runtime visibility

- Provider settings now expose capability summaries directly in list/detail UI.
- Runtime diagnostics now surface:
  - Responses-ready providers
  - active observed Responses protocols from runtime logs
  - WebSocket-ready providers
  - WebSocket fallback counts
  - compact request counts
  - local fallback counts
  - local compression savings and ratio
  - compact fallback reasons
  - compact-ready providers distinct from declared-capable providers

## Official API Alignment

The current routing direction matches OpenAI's current documentation shape:

- Conversation state is carried by `previous_response_id` on Responses API chains.
- Server-side long-context handling is expressed through `context_management`.
- Compaction is a Responses capability, not a universal guarantee for all OpenAI-compatible relays.

Implication for IsleMind:

- Responses support must remain capability-driven.
- Relay compatibility should not be inferred from label or preset alone.
- Remote compact in `required` mode should continue to block when provider support is not declared.

## Compatibility Boundary

This document covers only one slice of the broader AI access-layer goal. Long-context support must be evaluated together with:

- provider/model catalog coverage,
- protocol and transport semantics,
- cache and context reuse,
- tool and MCP behavior,
- model-list sync and alias lifecycle,
- user-facing diagnostics for degraded paths.

### Confirmed strong paths

- OpenAI official providers with Responses support
- xAI-style Responses-compatible providers already modeled with preferred endpoint metadata
- OpenAI-compatible relays that explicitly declare `responsesApi`
- Azure OpenAI v1 resource endpoints with explicit resource base URL and API-key auth
- Vertex AI OpenAI-compatible endpoints with explicit `/endpoints/openapi` base URL and Google Cloud access-token bearer auth

### Expanded provider coverage now modeled in the registry

- Official families:
  - OpenAI
  - Anthropic
  - Google Gemini
  - Xiaomi MiMo
- OpenAI-compatible vendors and clouds:
  - DeepSeek
  - DashScope / Qwen
  - Moonshot / Kimi
  - BigModel / GLM
  - MiniMax
  - xAI / Grok
  - Mistral
  - Groq
  - Together AI
  - Fireworks AI
  - Cohere compatibility API
  - Cerebras
  - SambaNova
  - NVIDIA NIM
  - Hugging Face Inference Providers
  - GitHub Models
  - DeepInfra
  - Novita
  - SiliconFlow
  - ModelScope
  - Volcengine Ark
  - Baidu Qianfan
  - Tencent Hunyuan
  - Baichuan
  - StepFun
  - 01.AI
  - Azure OpenAI v1
  - AWS Bedrock
  - Vertex AI
- Aggregators and relays:
  - OpenRouter
  - NewAPI / OneAPI
  - Sub2API
- Local runtimes:
  - Ollama
  - LM Studio
  - LocalAI
  - vLLM
  - SGLang

### Still partial or provider-specific

- Anthropic-compatible relays do not share OpenAI Responses semantics
- OpenAI-compatible providers without explicit Responses capability still fall back to chat-completions behavior
- Remote compact visibility is improved, but per-conversation trace details are still more precise than high-level settings diagnostics
- Some providers intentionally suppress generic model-list sync because `/models` behavior is not universal even when chat requests are OpenAI-compatible
- Azure OpenAI legacy deployment paths such as `/openai/deployments/{deployment}` still need dedicated routing and API-version handling.
- Azure OpenAI Microsoft Entra ID auth is not yet implemented; the current Azure v1 support is API-key based.
- AWS Bedrock Mantle OpenAI-compatible endpoints are partial-ready for chat, Responses, and model-list routing. Bedrock Runtime endpoints can prepare signed non-streaming `InvokeModel` requests when AWS credentials are supplied; model-list sync, streaming, remote compact, native tools, and broader model-family transforms still fail closed with explicit explanations.
- Vertex AI OpenAI-compatible endpoints are partial-ready through `/endpoints/openapi`, while native Vertex Gemini REST endpoints still fail closed with explicit explanations.

### Hosted fail-closed behavior

Cloud-hosted providers are not considered successful merely because a user entered a Base URL.

- Azure OpenAI v1 is a partial ready path when the resource URL is under `/openai/v1` and API-key auth is used.
- Azure legacy deployment URLs remain planned because they require deployment-name and API-version aware routing.
- AWS Bedrock Mantle is a partial-ready hosted compatibility path when the Base URL uses `https://bedrock-mantle.{region}.api.aws/v1` and the API key field contains a Bedrock API key.
- AWS Bedrock Runtime has partial non-streaming request preparation: JSON/env-style AWS credentials are parsed, region is inferred from `bedrock-runtime.{region}.amazonaws.com`, Anthropic Messages bodies receive `anthropic_version: bedrock-2023-05-31`, and requests are signed for `POST /model/{modelId}/invoke`.
- AWS Bedrock Runtime remains planned for model-list sync, streaming, remote compact, provider-native tools, Converse, and non-Anthropic model-family transforms.
- Vertex AI OpenAI-compatible endpoints are partial-ready when the Base URL includes `/v1/projects/{project}/locations/{location}/endpoints/openapi` and the API key field contains a Google Cloud access token.
- Native Vertex Gemini REST endpoints remain planned because they require Google Cloud authentication plus project, location, publisher, and model-aware paths.

The provider runtime now checks this boundary before model tests, model-list sync, and normal chat requests. Unsupported hosted paths return a clear provider-operation message rather than issuing a malformed generic OpenAI-compatible request.

### Official Azure v1 alignment

The Azure OpenAI v1 implementation is intentionally scoped to the current Microsoft Foundry v1 API shape:

- Microsoft documents the v1 base URL as the Azure resource endpoint with `/openai/v1` appended, including both `openai.azure.com` and `services.ai.azure.com` host styles.
- The Azure Responses REST example posts to `/openai/v1/responses` and authenticates with the `api-key` header.
- The Azure v1 REST model reference uses `{endpoint}/openai/v1` and also documents API-key auth through `api-key`.
- AWS documents Bedrock Mantle as the recommended OpenAI-compatible endpoint for new Bedrock applications. The base URL follows `https://bedrock-mantle.{region}.api.aws/v1`, the Models API is available at `/v1/models`, and the Responses API is available at `/v1/responses` with Bedrock API-key bearer authentication.

References:

- [Azure OpenAI in Microsoft Foundry Models v1 API](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle)
- [Use the Azure OpenAI Responses API](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)
- [Azure OpenAI in Microsoft Foundry Models v1 REST API reference](https://learn.microsoft.com/en-us/azure/foundry/openai/latest)
- [Azure OpenAI models REST reference](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/models)
- [Amazon Bedrock Mantle Responses API](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html)
- [Amazon Bedrock endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/bedrock.html)
- [Amazon Bedrock Runtime InvokeModel API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html)
- [Vertex AI generative model REST reference](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference)
- [Vertex AI OpenAI-compatible interface](https://cloud.google.com/vertex-ai/generative-ai/docs/start/openai)

## Remaining Gaps

1. Active-path visibility is still aggregate-first

- Runtime diagnostics now distinguish declared, ready, and observed counts, but they still summarize from recent runtime logs and compact usage records.
- There is not yet a first-class per-provider "currently active protocol" badge in provider settings.

2. Relay compatibility remains opt-in by declaration

- This is still the correct safety boundary.
- Future work should improve import/probe flows so compatible relays can self-identify Responses support more easily without manual capability edits.

3. Remote compaction readiness is not yet probe-verified

- IsleMind now routes official and declared-compatible providers correctly, but readiness still depends on declared capabilities plus runtime outcomes.
- There is not yet a dedicated provider probe that confirms remote compaction support independently of normal chat traffic.

## Next Iteration Plan

1. Tighten banner/detail language

- If needed, add a compact detail sheet that shows:
  - local summary section counts
  - source/kept message counts
  - remote vs local decision path without opening raw traces

2. Expand runtime diagnostics precision

- If needed, add provider-row status that distinguishes:
  - declared capability
  - ready capability
  - recently observed active path

3. Improve provider capability lifecycle

- Consider probe/import helpers for relays that support Responses or remote compact but are currently imported as generic OpenAI-compatible providers.

4. Add more explicit relay tests

- Keep testing:
  - `previous_response_id`
  - `context_management`
  - token-based compaction threshold forwarding
  - `/responses` endpoint routing
  - local fallback under compact pressure
  - runtime diagnostic aggregation from log tails

## Evidence

- [src/components/chat/ChatWorkspace.tsx](G:\Project\IsleMind\src\components\chat\ChatWorkspace.tsx)
- [src/services/contextPacker.ts](G:\Project\IsleMind\src\services\contextPacker.ts)
- [src/services/ai/providerOpenAIRequest.ts](G:\Project\IsleMind\src\services\ai\providerOpenAIRequest.ts)
- [src/services/ai/providerConformance.ts](G:\Project\IsleMind\src\services\ai\providerConformance.ts)
- [src/services/runtimeDiagnostics.ts](G:\Project\IsleMind\src\services\runtimeDiagnostics.ts)
- [src/components/settings/ApiKeyPanel.tsx](G:\Project\IsleMind\src\components\settings\ApiKeyPanel.tsx)
- [src/components/providers/ProviderSettingsContent.tsx](G:\Project\IsleMind\src\components\providers\ProviderSettingsContent.tsx)
- [src/components/main/SettingsScreenContent.tsx](G:\Project\IsleMind\src\components\main\SettingsScreenContent.tsx)
- [scripts/provider-intelligence-tests.js](G:\Project\IsleMind\scripts\provider-intelligence-tests.js)
