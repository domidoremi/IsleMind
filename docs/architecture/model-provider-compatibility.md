# Model Provider Compatibility Contract

Last updated: 2026-06-21

## Scope

This document tracks the compatibility contract required for IsleMind provider support. The executable source of truth for provider documentation evidence is `src/services/ai/providerCompatibilityContract.ts`; runtime request behavior remains in the existing provider conformance and routing modules.

The goal is capability-driven routing, not provider-name branching. A provider is considered compatible only when the relevant behavior is backed by official documentation, encoded in the provider contract, and covered by focused tests.

## Current Source Surfaces

| Surface | Current role |
| --- | --- |
| `src/services/ai/providerRegistry.ts` | Provider presets, base URLs, protocol type, static capability declarations, import detection. |
| `src/types/modelCatalog.ts` | Built-in model metadata, context/output limits, source URLs, reasoning modes, deprecation notes. |
| `src/services/ai/providerConformance.ts` | Capability manifest, request hardening, reasoning/tool/modality shape selection. |
| `src/services/ai/base.ts` | Request body assembly for OpenAI-compatible, Responses, Anthropic, Google, and MiMo protocol paths. |
| `src/services/ai/providerCompatibilityContract.ts` | Official documentation evidence and audit state for every current provider preset. |
| `scripts/provider-intelligence-tests.js` | Offline conformance and compatibility regression checks. |

## Required Behavior Axes

Every provider entry is audited against these axes when they apply:

- Authentication and credential placement.
- Chat endpoint path and request body shape.
- Streaming transport and chunk parsing.
- Context window, output-token limits, truncation, and compression boundaries.
- System prompt placement and provider-specific system/developer instruction policy.
- Safety, refusal, moderation, and provider-side policy behavior where the API exposes it.
- Tool/function calling request shape and response replay.
- Structured output or JSON/schema constraints.
- Vision, file, audio, and other multimodal payloads.
- Reasoning, thinking, or effort controls.
- Embeddings and rerank support when exposed by the provider family.
- Model-list discovery, alias, deprecation, and sync behavior.
- Error, rate-limit, retry, and timeout behavior.
- Citation/grounding metadata when provider-native search is enabled.
- Relay or hosted routing behavior when a provider fronts multiple upstream models or cloud resources.

## Audit States

| State | Meaning |
| --- | --- |
| `conformance-ready` | Official docs are mapped and the current offline tests cover the important request/response contract for this provider family. |
| `docs-mapped` | Official docs are mapped, but more provider-specific golden tests or live smoke evidence are still needed. |
| `needs-live-smoke` | The static route is modeled, but hosted/cloud behavior depends on account, region, project, or live credentials. |
| `protocol-reference` | The provider is a custom relay or local runtime; docs describe the protocol target, while final behavior must come from declaration, probing, or user configuration. |

## Priority Matrix

| Provider | Docs source | Runtime contract status | Next evidence needed |
| --- | --- | --- | --- |
| OpenAI | `developers.openai.com`, `platform.openai.com` | `conformance-ready` | Keep Responses, tools, structured output, files, and model deprecation fixtures current. |
| Anthropic | `docs.anthropic.com` | `conformance-ready` | Keep thinking, tool-use, citation, and web-search version fixtures current. |
| Google Gemini | `ai.google.dev` | `conformance-ready` | Keep generateContent, thinking budget/level, function calling, structured output, and grounding fixtures current. |
| xAI | `docs.x.ai` | `conformance-ready` | Keep Responses, `response_format` structured output, native search, reasoning effort, encrypted reasoning replay, and model retirement fixtures current. |
| DeepSeek | `api-docs.deepseek.com` | `conformance-ready` | Keep JSON object mode, thinking/non-thinking alias, `reasoning_content` replay, and deprecation fixtures current. JSON Schema request controls remain unclaimed until official docs add them. |
| DashScope / Qwen | `help.aliyun.com/zh/model-studio` | `conformance-ready` | Keep chat-completions, `stream_options.include_usage`, Qwen thinking, OpenAI-format tools, and `image_url` fixtures current. Generic `/models`, `file_data`, `response_format`, `/audio/transcriptions`, `/audio/speech`, and Qwen-Omni chat audio are intentionally unclaimed until runtime support is source-backed. |
| Moonshot / Kimi | `platform.kimi.ai`, `platform.moonshot.ai` | `conformance-ready` | Keep Kimi K2 thinking, max-completion-token, vision, and reasoning replay fixtures current. |
| BigModel / GLM | `docs.bigmodel.cn` | `conformance-ready` | Keep `/api/paas/v4/chat/completions`, Bearer auth, `max_tokens`, OpenAI-format tools, `image_url` vision, static/manual catalog behavior, OpenAI-compatible parsing, and rate-limit diagnostics current. Generic `/models`, `file_data`, `response_format`, and reasoning controls are intentionally unclaimed. |
| Tencent Hunyuan | `cloud.tencent.com/document/product/1729` | `conformance-ready` | Keep `/v1/chat/completions`, `/v1/models`, Bearer auth, `max_tokens`, OpenAI-format tools, `image_url` vision, model metadata sync, OpenAI-compatible parsing, and rate-limit diagnostics current. Generic `file_data`, `response_format`, audio/speech, embeddings, rerank, Responses, and reasoning controls are intentionally unclaimed. |
| Baidu Qianfan | `cloud.baidu.com/doc/WENXINWORKSHOP` | `conformance-ready` | Keep `/v2/chat/completions`, `/v2/models`, Bearer auth, `max_tokens`, OpenAI-format tools, `image_url` vision, model metadata sync, OpenAI-compatible parsing, and rate-limit diagnostics current. Generic `file_data`, `response_format`, audio/speech, embeddings, rerank, Responses, and reasoning controls are intentionally unclaimed. |
| Baichuan | `platform.baichuan-ai.com/docs/api` | `conformance-ready` | Keep `/v1/chat/completions`, Bearer auth, `stream`, `max_tokens`, static/manual catalog behavior, OpenAI-compatible parsing, and error diagnostics current. Generic `/models`, OpenAI-format tools, `image_url` vision, `file_data`, `response_format`, audio/speech, embeddings, rerank, Responses, and reasoning controls are intentionally unclaimed. |
| 01.AI / Yi | `platform.lingyiwanwu.com/docs/api-reference` | `conformance-ready` | Keep `/v1/chat/completions`, `/v1/models`, Bearer auth, `stream`, OpenAI-format tools/tool calls, `image_url` vision, `max_tokens`, model metadata sync, OpenAI-compatible parsing, and 429 diagnostics current. Generic `file_data`, `response_format`, audio/speech, embeddings, rerank, Responses, and reasoning controls are intentionally unclaimed. |
| StepFun | `platform.stepfun.com/docs/zh` | `conformance-ready` | Keep current Mintlify Chat Completions, `/v1/models`, Bearer auth, `stream`, OpenAI-format tools/tool calls, `image_url` vision, `max_tokens`, model metadata sync, OpenAI-compatible parsing, and 429 diagnostics current. Generic `file_data`, `response_format`, audio/speech, embeddings, rerank, Responses, and reasoning controls are intentionally unclaimed. |
| MiniMax | `platform.minimax.io` | `conformance-ready` | Keep `/v1/chat/completions`, `max_completion_tokens`, adaptive `thinking`, `reasoning_split`, `reasoning_details`, tools, `image_url`, and `video_url` fixtures current. Generic `/models` and `file_data` are intentionally unclaimed. |
| Mistral | `docs.mistral.ai` | `conformance-ready` | Keep `/v1/chat/completions`, `/v1/models`, function tools, `image_url`, `/v1/embeddings`, and Magistral thinking-chunk parsing current. Generic `file_data`, `input_audio`, `/audio/transcriptions`, and `response_format` request controls are intentionally unclaimed until Mistral-specific app routing exists. |
| Groq | `console.groq.com/docs` | `conformance-ready` | Keep `/openai/v1/chat/completions`, beta `/openai/v1/responses`, `/openai/v1/models`, tools, `image_url`, `/audio/transcriptions`, `/audio/speech`, `max_completion_tokens`, and qwen3/gpt-oss `reasoning_effort` fixtures current. `response_format` request controls, Compound/web-search fields, generic files, and citation behavior are intentionally unclaimed until Groq-specific app routing exists. |
| Together AI | `docs.together.ai` | `conformance-ready` | Keep `/v1/chat/completions`, `/v1/models`, `/v1/embeddings`, tools, `image_url`, `/audio/transcriptions`, `/audio/speech`, `max_tokens`, and GPT-OSS `reasoning_effort` fixtures current. `/v1/rerank`, `response_format`, chat `audio_url` input, and generic file attachments are intentionally unclaimed until app routing exists. |
| Fireworks AI | `docs.fireworks.ai` | `conformance-ready` | Keep `/inference/v1/chat/completions`, `/inference/v1/responses`, `/inference/v1/models`, `/inference/v1/embeddings`, tools, `image_url`, `max_tokens`, `reasoning_content`, and model-family `reasoning_effort` fixtures current. `/inference/v1/rerank`, `response_format`, generic file attachments, chat audio/video inputs, and Files API `mm_file://` routing are intentionally unclaimed until app routing exists. |
| Perplexity Sonar | `docs.perplexity.ai` | `conformance-ready` | Keep `/v1/sonar`, provider-native search, top-level `citations`/`search_results`, JSON Schema output, `image_url`, `file_url`, `max_tokens`, and reasoning-model `reasoning_effort` fixtures current. Generic `/models`, OpenAI Responses routing, and OpenAI-format function tools are intentionally unclaimed. |
| Cohere | `docs.cohere.com` | `conformance-ready` | Keep Compatibility API `/chat/completions`, `/embeddings`, `/audio/transcriptions`, tools, structured outputs, `max_tokens`, and `reasoning_effort: none | high` fixtures current. Generic `/models` sync, Compatibility API file attachments, native `/v2/chat` documents/citations, and native `/v2/rerank` app routing are intentionally unclaimed until provider-specific routing exists. |
| Cerebras | `inference-docs.cerebras.ai` | `conformance-ready` | Keep `/v1/chat/completions`, `/v1/models`, `max_completion_tokens`, function tools, strict JSON schema `response_format`, JSON object mode, `reasoning` replay, GPT OSS `reasoning_effort: low | medium | high`, and Z.ai GLM `reasoning_effort: none` fixtures current. Public shared-endpoint vision, file attachments, audio, embeddings, rerank, and OpenAI Responses routing are intentionally unclaimed. |
| SambaNova | `sambanova-systems.mintlify.dev` | `conformance-ready` | Keep `/v1/chat/completions`, `/v1/responses`, `/v1/models`, `max_tokens`, function tools, JSON object/schema `response_format`, base64 `image_url`, `reasoning` replay, and GPT OSS `reasoning_effort: low | medium | high` fixtures current. Generic files, chat audio input, SambaStack-only audio/embeddings, rerank, speech, native search, and unselected Responses routing are intentionally unclaimed. |
| NVIDIA NIM | `docs.api.nvidia.com/nim` | `conformance-ready` | Keep `https://integrate.api.nvidia.com/v1`, `/v1/chat/completions`, `/v1/models`, Bearer auth, OpenAI-compatible responses, `max_tokens`, and model-specific `image_url` vision fixtures current. Generic tools/function calling, `response_format`, `reasoning_effort`, files, audio, speech, embeddings, and rerank are intentionally unclaimed until NVIDIA docs and app routing prove those surfaces for the default integrate API. |
| Hugging Face Inference Providers | `huggingface.co/docs/inference-providers` | `conformance-ready` | Keep `https://router.huggingface.co/v1`, `/v1/chat/completions`, `/v1/responses`, `/v1/models`, OpenAI-compatible tools, structured-output docs, `image_url` VLM chat, `max_tokens`, and GPT-OSS `reasoning_effort: low | medium | high` fixtures current. Generic `file_data`, audio, speech, embeddings, rerank, provider-independent reasoning, and unselected Responses routing are intentionally unclaimed. |
| GitHub Models | `docs.github.com/en/github-models` | `conformance-ready` | Keep `https://models.github.ai/inference`, `/chat/completions`, `/models`, GitHub token Bearer auth, OpenAI-compatible responses, `max_tokens`, OpenAI-format tools, and model-metadata `image_url` vision fixtures current. Generic `file_data`, audio, speech, `reasoning_effort`, embeddings, rerank, structured-output request controls, and OpenAI Responses routing are intentionally unclaimed until source-backed. |
| DeepInfra | `docs.deepinfra.com` | `conformance-ready` | Keep `https://api.deepinfra.com/v1/openai`, `/chat/completions`, `/models`, `/embeddings`, Bearer auth, OpenAI-format tools, structured-output docs, `image_url` vision, `max_tokens`, metadata-tagged model sync, and `reasoning_effort: none | low | medium | high` fixtures current. Generic `file_data`, chat audio, OpenAI Responses routing, and native `/v1/inference` rerank/audio/TTS are intentionally unclaimed until app routing exists. |
| Novita AI | `novita.ai/docs` | `conformance-ready` | Keep `https://api.novita.ai/openai` normalized to `/openai/v1`, `/chat/completions`, `/models`, `/embeddings`, Bearer auth, OpenAI-format tools, structured-output docs, `image_url` vision, `reasoning_content` parsing, `max_tokens`, and `context_size`/`max_output_tokens`/`features`/`input_modalities` model sync current. Legacy `/v3/openai` user URLs remain detectable. Generic `file_data`, chat audio, speech, OpenAI Responses, `reasoning_effort`, and native `/rerank` app routing are intentionally unclaimed. |
| SiliconFlow | `docs.siliconflow.cn` | `conformance-ready` | Keep `https://api.siliconflow.cn/v1`, `/chat/completions`, authenticated `/models`, `/embeddings`, Bearer auth, OpenAI-format tools, JSON mode docs, `image_url` multimodal chat, `reasoning_content`, model-specific `thinking_budget`, and 429/rate-limit fixtures current. Generic `file_data`, chat audio/video, native `/rerank`, TTS/speech, OpenAI Responses, and multimodal embedding/rerank routing are intentionally unclaimed until app routing exists. |
| ModelScope | `modelscope.cn/docs` + `api-inference.modelscope.cn` | `conformance-ready` | Keep `https://api-inference.modelscope.cn/v1`, `/chat/completions`, public `/models`, `/embeddings`, Bearer auth diagnostics, OpenAI-compatible parsing, `max_tokens`, and request-id error fixtures current. Qwen/DeepSeek model ids must not inherit DashScope `enable_thinking`, `thinking_budget`, or `stream_options.include_usage`. Vision, generic files, chat audio, transcription, speech, OpenAI Responses, `reasoning_effort`, structured-output controls, and OpenAI-format tools are intentionally unclaimed until source-backed ModelScope fixtures prove them. |
| Volcengine Ark / Doubao | `volcengine.com/docs/82379` | `conformance-ready` | Keep `/api/v3/chat/completions`, `/api/v3/models`, Bearer auth, `max_tokens`, OpenAI-format tools/tool calls, `image_url` vision, model metadata sync, OpenAI-compatible parsing, 429/rate-limit diagnostics, and model-deprecation docs current. Stale `1298454` / `1263482` paths are intentionally replaced. Generic `file_data`, `response_format`, chat audio, transcription, speech, embeddings, rerank, Responses, and reasoning controls are intentionally unclaimed. |
| Xiaomi MiMo | `platform.xiaomimimo.com` | `conformance-ready` | MiMo native web search now has offline body, manifest, and citation coverage. Add live smoke when credentials are available. |
| OpenRouter | `openrouter.ai/docs` | `conformance-ready` | Keep `/api/v1/chat/completions`, explicit `/api/v1/responses` opt-in, `/api/v1/models`, OpenAI-format tools, `response_format` structured output gated by `supported_parameters`, documented PDF `file_data` input, model metadata, citation parsing, and relay rate-limit fixtures current. |
| NewAPI / OneAPI | `docs.newapi.pro` | `conformance-ready` | Keep current Chinese ChatCompletions, Responses, Models, tool-call, Chat `response_format`, model-metadata-gated reasoning, 400/429, and unimplemented Files 501 fixtures current. Responses structured-output controls, provider-wide files, relay vision, and audio routing stay unclaimed until source-backed model metadata, known catalog entries, manual capability declarations, or app fixtures exist. |
| Sub2API | `sub2api.info`, `github.com/Wei-Shaw/sub2api` | `docs-mapped` | Preserve mixed upstream capabilities through `relayRouting`; keep chat/model-list/optional-Responses routing and tool pass-through fixtures current while leaving `response_format`, `reasoning_effort`, generic files, and provider-wide vision unclaimed until endpoint-level Sub2API docs, remote model metadata, or explicit user capability declarations prove them. |
| Azure OpenAI | `learn.microsoft.com/azure/ai-foundry/openai` | `conformance-ready` | Keep `/openai/v1/chat/completions`, `/openai/v1/responses`, `/openai/v1/models`, Azure API-key auth, Chat `response_format`, Responses file input, model-metadata-gated Responses reasoning, and legacy deployment-path gap fixtures current. Live smoke still depends on the user's Azure resource and deployment. |
| AWS Bedrock | `docs.aws.amazon.com/bedrock` | `needs-live-smoke` | Keep current Bedrock Mantle Chat Completions docs, `/v1/chat/completions`, `/v1/models`, Bearer API-key auth, streaming, and Runtime `/model/{modelId}/invoke` SigV4 fixtures current. Bedrock Responses, structured output, OpenAI-format tools, multimodal/files, reasoning controls, Runtime model-list, Runtime streaming, Converse, and account/model access still require current AWS docs or live AWS evidence. |
| Vertex AI | `cloud.google.com/vertex-ai` | `needs-live-smoke` | Keep Vertex OpenAI-compatible `/v1/projects/{project}/locations/{location}/endpoints/openapi/chat/completions`, bearer access-token auth, streaming, OpenAI-format tools, `response_format`, `image_url`, and `reasoning_effort` fixtures current. Automatic `/models` sync, generic OpenAI `file_data`, Responses routing, native `generateContent` routing, and live account/model access remain manual or planned until current Google Cloud docs or live smoke prove them. |
| Ollama / LM Studio / LocalAI / vLLM / SGLang | Local runtime docs | `protocol-reference` | Ollama, LM Studio, LocalAI, vLLM, and SGLang now map current local-runtime docs for Chat/models/embeddings/tool/structured-output surfaces; installed model/backend capability remains runtime state with optional LAN/local smoke fixtures. |
| Custom compatible endpoints | OpenAI Chat/Responses and Anthropic Messages protocol docs | `protocol-reference` | Treat default custom endpoints as text-first protocol references; tools, structured output, vision, files, reasoning, Responses, audio, and native search require declaration, probing, remote model metadata, or manual capability configuration before claiming support. |

## Development Loop

1. Pick one provider family and read its official API docs for the behavior axes above.
2. Update `providerCompatibilityContract.ts` first when a docs source or audit state changes.
3. Update model catalog metadata only with a source URL, verified date, and deprecation/alias rationale.
4. Update request builders, response parsers, conformance manifest, and runtime diagnostics as needed.
5. Add offline provider-intelligence tests for request body shape, stream parsing, tool calls, structured output, modality blocks, citations, and error/retry behavior.
6. Add optional live smoke only behind explicit credentials or environment gates.
7. Run the smallest focused gate first, then widen to `bun run test:provider-intelligence` and type-check when the slice touches shared runtime behavior.

## Current Verified Slices

### OpenAI Responses Structured Output

This slice covers OpenAI's official Responses and Chat Completions routes.

- Official OpenAI API docs are mapped for Responses, Chat Completions, function calling, structured outputs, files, audio, reasoning, and model metadata.
- OpenAI Responses requests send JSON/schema controls through the documented `text.format` shape.
- OpenAI Chat Completions requests keep JSON object/schema controls on `response_format`.
- Provider conformance records the OpenAI family, Responses protocol, source-backed structured-output request controls, strict JSON schema support, reasoning summaries, encrypted reasoning replay, native web search, and model-level streaming constraints.
- OpenAI Responses tool replay preserves reasoning items before `function_call` / `function_call_output` items.
- OpenAI SSE parsing preserves output deltas, response ids, and token usage.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=openai-provider-compatibility`.

### Anthropic Tool-Schema Structured Output

This slice covers Anthropic's official Messages route.

- Official Anthropic Messages, tool-use, extended-thinking, and citation docs are mapped in the executable provider contract.
- Anthropic structured-output requests use the documented tool `input_schema` route and force the schema tool with `tool_choice`.
- Anthropic requests do not emit OpenAI `response_format` or Responses `text.format` fields.
- Provider conformance records the Anthropic family, Messages protocol, source-backed `anthropic-tool-schema` request shape, tool support, reasoning state passthrough, and non-strict schema guarantee.
- Anthropic non-streaming structured-output tool results are converted to JSON text and filtered out of executable provider tool calls.
- Anthropic SSE parsing preserves streamed structured-output tool names and merged JSON arguments.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=anthropic-provider-compatibility`.

### DeepSeek JSON Object Structured Output

This slice covers DeepSeek's official OpenAI-compatible Chat Completions route.

- Official DeepSeek chat completion, thinking mode, and JSON Output docs are mapped in the executable provider contract.
- DeepSeek JSON Output requests send the documented `response_format: { "type": "json_object" }` shape.
- DeepSeek JSON Schema requests are intentionally blocked because the official JSON Output guide documents JSON object mode, prompt guidance, `max_tokens` sizing, and occasional empty content behavior, but not schema request controls.
- Provider conformance records the DeepSeek family, OpenAI-compatible protocol, source-backed `openai-json-object-response-format` request shape, JSON object support, and non-strict JSON Schema guarantee.
- Route decisions expose DeepSeek schema requests as blocked with `unsupported_structured_output` instead of silently sending unsupported schema payloads.
- DeepSeek thinking requests still emit `thinking` / `reasoning_effort`, and OpenAI-compatible streaming still preserves `reasoning_content` for replay without mixing it into visible answer text.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=deepseek-provider-compatibility`.

### xAI Responses Compatibility

This slice covers xAI's official Responses and Chat Completions routes.

- Official xAI API reference, function calling, structured outputs, live search, reasoning, and model docs are mapped in the executable provider contract.
- xAI Responses requests send structured-output controls through the documented top-level `response_format` shape, not OpenAI's `text.format`.
- xAI Chat Completions fallback models also use `response_format` for JSON object/schema output.
- Provider conformance records the xAI family, Responses protocol, source-backed `xai-response-format` request shape, schema-guaranteed structured outputs, `max_output_tokens`, `reasoning.effort`, encrypted reasoning replay, and native `web_search`.
- xAI Responses requests do not inherit OpenAI-only `reasoning.summary`; they request `include: ["reasoning.encrypted_content"]` only when reasoning replay is useful.
- xAI Responses tool replay preserves encrypted reasoning items before `function_call` / `function_call_output` items.
- xAI SSE parsing preserves output deltas, response ids, and token usage through the OpenAI-compatible parser.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=xai-provider-compatibility`.

### Xiaomi MiMo Native Search

This slice covers Xiaomi MiMo native web search.

- Preset capability declares native search.
- OpenAI-compatible MiMo chat requests insert the documented `web_search` tool only for supported chat models.
- Anthropic-compatible MiMo requests do not emit unsupported web-search tools.
- Provider conformance records the effective native search tool type.
- MiMo response annotations and streaming annotation packets become provider web citations.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=mimo-native-search`.

### Moonshot Kimi Thinking And Tool Replay

This slice covers Moonshot/Kimi OpenAI-compatible chat behavior.

- Official Kimi docs are mapped for model metadata, K2 thinking models, and the K2.6 quickstart path.
- Moonshot requests preserve `/v1/chat/completions` routing and use `max_completion_tokens`.
- Kimi K2 thinking requests send the documented `thinking.type` toggle and keep fixed sampling parameters out of thinking-mode calls.
- Assistant reasoning state is replayed as `reasoning_content`, and tool result continuation requests add `thinking.keep: all`.
- Kimi vision-capable models retain OpenAI-compatible image attachment parts.
- Provider conformance records the Kimi thinking request shape, max-token field, reasoning-state preservation field, and OpenAI-format tool declarations.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=moonshot-provider-compatibility`.

### BigModel GLM Documentation Refresh

This slice covers BigModel/GLM documentation evidence and the current conservative runtime boundary.

- The old `docs.bigmodel.cn/cn/api/paas/v4/chat-completions` link now returns 404 and must not be used as evidence.
- The current API reference is `https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8`, which documents `POST https://open.bigmodel.cn/api/paas/v4/chat/completions`.
- The official OpenAPI document currently exposes `/paas/v4/chat/completions` and `/paas/v4/async/chat/completions`, but not `/paas/v4/models`; IsleMind therefore disables generic remote model-list sync for this preset.
- BigModel chat docs include `image_url` vision parts and JSON object response formatting; generic local `file_data` attachments, `response_format` request controls, and reasoning controls are not claimed.
- API introduction and rate-limit docs remain mapped for authentication, base request shape, errors, and throttling policy.
- Provider conformance records the `bigmodel` family, OpenAI-compatible protocol, `max_tokens`, OpenAI-format tools, image input, disabled model-list/file/reasoning/structured-output request controls, source-backed official docs, and rate-limit diagnostics.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=bigmodel-provider-compatibility`.

### Tencent Hunyuan Chat Tools Vision And Model Sync

This slice covers the Tencent Hunyuan OpenAI-compatible route behind `https://api.hunyuan.cloud.tencent.com/v1`.

- Official Tencent Cloud docs are mapped for Chat Completions, model listing, streaming, tool calls, multimodal `image_url` input, authentication, errors, and rate-limit behavior.
- The preset keeps `/v1/chat/completions`, `/v1/models`, Bearer auth, OpenAI-format tools, and `image_url` vision enabled.
- Chat requests use `max_tokens` and avoid unimplemented `response_format`, `reasoning_effort`, and Responses request shapes.
- Model sync calls `/v1/models` and preserves context/output-token and vision metadata when the upstream payload exposes it.
- The preset does not claim generic `file_data` attachments, chat audio input, audio transcription, speech output, embeddings, rerank, OpenAI Responses, or reasoning controls until provider-specific routing exists.
- Provider conformance records the `tencent-hunyuan` family, OpenAI-compatible protocol, `max_tokens`, image input, OpenAI-format tools, disabled file/audio/speech/reasoning/structured-output request controls, and source-backed official docs.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=tencent-hunyuan-provider-compatibility`.

### Baidu Qianfan Chat Tools Vision And Model Sync

This slice covers the Baidu Qianfan OpenAI-compatible route behind `https://qianfan.baidubce.com/v2`.

- Official Baidu Cloud docs are mapped for Chat Completions, model listing, streaming, tool calls, multimodal `image_url` input, authentication, errors, and rate-limit behavior.
- The preset keeps `/v2/chat/completions`, `/v2/models`, Bearer auth, OpenAI-format tools, and `image_url` vision enabled.
- Chat requests use `max_tokens` and avoid unimplemented `response_format`, `reasoning_effort`, and Responses request shapes.
- Model sync calls `/v2/models` and preserves context/output-token and vision metadata when the upstream payload exposes it.
- The preset does not claim generic `file_data` attachments, chat audio input, audio transcription, speech output, embeddings, rerank, OpenAI Responses, or reasoning controls until provider-specific routing exists.
- Provider conformance records the `baidu-qianfan` family, OpenAI-compatible protocol, `max_tokens`, image input, OpenAI-format tools, disabled file/audio/speech/reasoning/structured-output request controls, and source-backed official docs.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=baidu-qianfan-provider-compatibility`.

### Baichuan Core Chat Completions

This slice covers the Baichuan OpenAI-compatible chat route behind `https://api.baichuan-ai.com/v1`.

- The official Baichuan API page and its static API chunk document `POST https://api.baichuan-ai.com/v1/chat/completions`, JSON `Content-Type`, `Authorization: Bearer ...`, the `stream` request switch, and an error-code section.
- The preset keeps chat and streaming enabled, but disables generic remote `/models` sync because the current official page does not document a model-list endpoint.
- Chat requests use `max_tokens` and avoid unimplemented `response_format`, `reasoning_effort`, provider tools, and Responses request shapes.
- Model selection stays static/manual until Baichuan exposes source-backed model metadata that IsleMind can sync safely.
- The preset does not claim OpenAI-format function tools, `image_url` vision, generic `file_data` attachments, chat audio input, audio transcription, speech output, embeddings, rerank, OpenAI Responses, or reasoning controls until provider-specific routing exists.
- Provider conformance records the `baichuan` family, OpenAI-compatible protocol, `max_tokens`, disabled model-list/tool/image/file/audio/speech/reasoning/structured-output request controls, and source-backed official docs.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=baichuan-provider-compatibility`.

### 01.AI Yi Chat Tools Vision And Model Sync

This slice covers the 01.AI / Lingyi Wanwu OpenAI-compatible route behind `https://api.lingyiwanwu.com/v1`.

- The official API reference documents `POST https://api.lingyiwanwu.com/v1/chat/completions`, `Authorization: Bearer ...`, the `stream` request switch, OpenAI-format function tools, streamed and non-streamed tool calls, multimodal `image_url` message parts, `https://api.lingyiwanwu.com/v1/models`, and 429 error behavior.
- The preset keeps `/v1/chat/completions`, `/v1/models`, Bearer auth, OpenAI-format tools, and `image_url` vision enabled.
- Chat requests use `max_tokens` and avoid unimplemented `response_format`, `reasoning_effort`, and Responses request shapes.
- Model sync calls `/v1/models` and preserves context/output-token and vision metadata when the upstream payload exposes it.
- The preset does not claim generic `file_data` attachments, chat audio input, audio transcription, speech output, embeddings, rerank, OpenAI Responses, or reasoning controls until provider-specific routing exists.
- Provider conformance records the `zero-one` family, OpenAI-compatible protocol, `max_tokens`, image input, OpenAI-format tools, disabled file/audio/speech/reasoning/structured-output request controls, and source-backed official docs.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=zero-one-provider-compatibility`.

### StepFun Chat Tools Vision And Model Sync

This slice covers the StepFun OpenAI-compatible route behind `https://api.stepfun.com/v1`.

- The old `https://platform.stepfun.com/docs/llm/chat-completion` and `https://platform.stepfun.com/docs/llm/model` paths now return 404 and must not be used as evidence.
- The current Mintlify docs are discoverable through `https://platform.stepfun.com/docs/llms.txt` and map Chat Completions, model listing, tool calling, image-chat guidance, error codes, Responses, audio, files, and other native surfaces.
- The official Chat Completions page documents `POST https://api.stepfun.com/v1/chat/completions`, `Authorization: Bearer ...`, `stream`, `max_tokens`, OpenAI-format `tools` and streamed/non-streamed `tool_calls`, `image_url` content parts, `response_format`, `reasoning_effort`, and 429/error behavior.
- The preset keeps `/v1/chat/completions`, `/v1/models`, Bearer auth, OpenAI-format tools, and `image_url` vision enabled.
- Chat requests use `max_tokens` and avoid unimplemented `response_format`, `reasoning_effort`, and Responses request shapes until StepFun-specific app mapping exists.
- Model sync calls `/v1/models` and preserves context/output-token and vision metadata when the upstream payload exposes it.
- The preset does not claim generic `file_data` attachments, chat audio input, audio transcription, speech output, embeddings, rerank, OpenAI Responses, or reasoning controls until provider-specific routing exists.
- Provider conformance records the `stepfun` family, OpenAI-compatible protocol, `max_tokens`, image input, OpenAI-format tools, disabled file/audio/speech/reasoning/structured-output request controls, and source-backed official docs.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=stepfun-provider-compatibility`.

### DashScope Qwen Conservative Compatibility

This slice covers the current DashScope/Qwen OpenAI-compatible chat boundary.

- Official DashScope docs are mapped for the OpenAI-compatible `/compatible-mode/v1/chat/completions` path, `stream_options.include_usage`, Qwen thinking controls, Qwen model selection, structured-output reference behavior, and Qwen-Omni `image_url` examples.
- The preset keeps `vision`, `reasoningEffort`, and OpenAI-format provider tools enabled.
- The preset does not claim generic `/models` sync, local `file_data` attachments, `response_format` request controls, `/audio/transcriptions`, or `/audio/speech`; Qwen-Omni chat audio remains a documented provider capability but is not yet mapped to IsleMind speech/transcription runtime paths.
- Provider conformance records DashScope family, `dashscope-thinking`, `stream_options.include_usage`, OpenAI-format tools, image input, and disabled file/audio/speech surfaces.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=dashscope-provider-compatibility`.

### MiniMax M3 Adaptive Thinking

This slice covers the MiniMax OpenAI-compatible chat boundary.

- The official MiniMax OpenAPI exposes `POST /v1/chat/completions` and documents `max_completion_tokens`, `thinking`, `reasoning_split`, `reasoning_details`, streaming, function tools, `image_url`, and `video_url`.
- The preset exposes provider tools and reasoning controls, but disables generic `/models` sync because the official OpenAPI does not list a model discovery path.
- The contract does not claim generic local `file_data` attachments; current IsleMind attachment types can cover `image_url`, while `video_url` remains provider-side evidence until the app has video attachment routing.
- Provider conformance records MiniMax family, OpenAI-compatible `max_completion_tokens`, `minimax-thinking`, `reasoning_split`, no reasoning state replay, OpenAI-format tools, image/video input, and the Anthropic-compatible wire-protocol branch.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=minimax-provider-compatibility`.

### Mistral Chat Tools Vision And Reasoning Chunks

This slice covers the current Mistral OpenAI-compatible chat boundary.

- Official Mistral docs are mapped through the current API endpoint pages for chat, models, embeddings, and audio transcription, plus `llms-full.txt` and current cookbook pages for function calling, vision, structured output, and Magistral reasoning chunks.
- The preset keeps official model-list sync, OpenAI-format function tools, and `image_url` vision enabled.
- The preset does not claim generic OpenAI `file_data` chat attachments, Voxtral `input_audio`, `/audio/transcriptions`, or reasoning-effort request controls until IsleMind has provider-specific routing for those surfaces.
- Chat requests use `max_tokens`, preserve OpenAI-compatible tool declarations and tool-result replay, keep `image_url` content parts, and avoid `max_completion_tokens`, `reasoning_effort`, and `response_format` fields that are not currently mapped by the app.
- Provider conformance records the `mistral` family, OpenAI-compatible protocol, `max_tokens`, OpenAI-format tools, image input, disabled file/audio surfaces, disabled reasoning-effort controls, and source-backed official docs.
- OpenAI-compatible parsing now extracts Mistral text content chunks and emits Magistral `thinking` chunks as reasoning traces for JSON and SSE responses.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=mistral-provider-compatibility`.

### Groq Chat Responses Audio And Reasoning

This slice covers the current Groq OpenAI-compatible boundary.

- Official Groq docs are mapped for the OpenAI-compatible base URL, `/openai/v1/chat/completions`, beta `/openai/v1/responses`, `/openai/v1/models`, tool use, structured outputs, vision, speech-to-text, text-to-speech, errors, rate limits, and reasoning fields.
- The preset keeps model-list sync, OpenAI-format tools, `image_url` vision, `/audio/transcriptions`, `/audio/speech`, beta Responses capability, and reasoning controls enabled.
- The preset does not claim generic file attachments, `response_format` request controls, or provider-native search. Groq Compound/web-search fields use provider-specific request fields and must not receive OpenAI `web_search_preview` until that routing is implemented.
- Chat requests use the official `max_completion_tokens` field and avoid deprecated `max_tokens`.
- qwen3 models can send `reasoning_effort: none | low | medium | high`; GPT-OSS models map oversized UI efforts down to `high` and omit unsupported `none`.
- Responses routing is used only when model metadata selects the beta Responses endpoint; native search and file attachments no longer force Groq into Responses routing.
- OpenAI-compatible parsing now preserves Groq `reasoning` fields as reasoning traces for JSON and SSE responses.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=groq-provider-compatibility`.

### Together Chat Audio Rerank And GPT-OSS Reasoning

This slice covers the current Together AI OpenAI-compatible boundary.

- Official Together docs are mapped for `/v1/chat/completions`, `/v1/models`, `/v1/embeddings`, `/v1/rerank`, function calling, JSON/schema output, `image_url` vision, speech-to-text, text-to-speech, errors, rate limits, and OpenAI-compatible GPT-OSS `reasoning_effort`.
- The preset keeps model-list sync, OpenAI-format tools, `image_url` vision, `/audio/transcriptions`, `/audio/speech`, and GPT-OSS reasoning controls enabled.
- The preset does not claim chat `audio_url` input, generic file attachments, `response_format` controls, or native `/v1/rerank` app routing because IsleMind currently routes image/pdf/text/document attachments and local reranking, not Together audio URL or rerank request mapping.
- Chat requests use the official `max_tokens` field and avoid `max_completion_tokens`.
- GPT-OSS models can send `reasoning_effort: low | medium | high`; oversized UI efforts map down to `high`, and unsupported `none` is omitted.
- Provider conformance records the `together` family, OpenAI-compatible protocol, `max_tokens`, image input, disabled file/audio input, speech output, OpenAI-format tools, and source-backed official docs.
- OpenAI-compatible parsing preserves Together `reasoning` fields as reasoning traces for JSON and SSE responses.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=together-provider-compatibility`.

### Fireworks Chat Responses Rerank And Reasoning

This slice covers the current Fireworks AI OpenAI-compatible boundary.

- Official Fireworks docs are mapped for `/inference/v1/chat/completions`, `/inference/v1/responses`, `/inference/v1/models`, `/inference/v1/embeddings`, `/inference/v1/rerank`, function tools, JSON/schema output, `image_url` vision, reasoning, errors, rate limits, and multimodal input limits.
- The preset keeps model-list sync, OpenAI-format tools, `image_url` vision, optional Responses routing, embeddings, and Fireworks reasoning controls enabled.
- The preset does not claim generic file attachments, chat audio/video inputs, audio transcription, speech output, `response_format` controls, native `/inference/v1/rerank`, or Files API `mm_file://` references because IsleMind attachments currently route image/pdf/text/document payloads without Fireworks-specific upload or rerank handling.
- Chat requests use the official `max_tokens` field and avoid `max_completion_tokens`, which Fireworks documents as an alias that cannot be sent together with `max_tokens`.
- Reasoning models use a Fireworks-specific `reasoning_effort` mapping: Qwen3 supports `none | low | medium | high`, DeepSeek V4 maps `xhigh` to `max`, GLM 5.2 collapses lower tiers to `high` and maps oversized tiers to `max`, and Harmony GPT-OSS omits unsupported `none`.
- Tool-result continuation requests preserve the documented `reasoning_content` field for Fireworks reasoning models.
- Provider conformance records the `fireworks` family, OpenAI-compatible protocol, `max_tokens`, image input, disabled file/audio/speech surfaces, OpenAI-format tools, source-backed official docs, and Responses protocol only when model metadata selects it.
- OpenAI-compatible parsing preserves Fireworks `reasoning_content` fields as reasoning traces for JSON and SSE responses.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=fireworks-provider-compatibility`.

### Perplexity Sonar Search Citations And Media

This slice covers the current Perplexity Sonar OpenAI-compatible boundary.

- Official Sonar docs are mapped for `POST /v1/sonar`, async `/v1/async/sonar`, streaming, JSON Schema `response_format`, media input, search filters, errors, rate limits, and provider-native citation metadata.
- The preset keeps model-list sync disabled because the official Sonar API reference does not expose a generic `/models` endpoint.
- Chat requests route to `https://api.perplexity.ai/v1/sonar`; older user-entered `/chat/completions` and `/v1` base URLs normalize to the Sonar endpoint.
- Image attachments use documented `image_url` content parts; file attachments use `file_url.url` with raw base64 and no `data:` prefix.
- Sonar reasoning models expose `reasoning_effort: minimal | low | medium | high`; oversized IsleMind effort values map down to `high`, and unsupported `none` is omitted.
- Provider-native search stays built into Sonar requests and must not inject OpenAI Responses `web_search_preview` tools.
- OpenAI-compatible parsing preserves Perplexity top-level `search_results` and `citations` as provider web citations for JSON and final streaming chunks.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=perplexity-provider-compatibility`.

### Cohere Compatibility API Chat Reasoning Audio And Rerank

This slice covers the current Cohere Compatibility API boundary.

- Official Cohere docs are mapped for OpenAI SDK Compatibility API chat, streaming, structured outputs, tools, embeddings, audio transcription, model metadata, native chat, native embed, and native rerank.
- The preset routes chat to `https://api.cohere.ai/compatibility/v1/chat/completions` and keeps OpenAI-format tools, `/compatibility/v1/embeddings`, `/compatibility/v1/audio/transcriptions`, and Command A `reasoning_effort` enabled.
- `reasoning_effort` is constrained to the documented `none | high` values. Unsupported UI efforts normalize to `high`; explicit `none` is preserved.
- Generic model-list sync is disabled because Cohere's official model listing is native `https://api.cohere.com/v1/models`, not the Compatibility API base URL that IsleMind's generic OpenAI-compatible discovery currently calls.
- Generic file attachments, Compatibility API vision routing, native `/v2/chat` documents/citations, and native `/v2/rerank` app routing stay unclaimed until provider-specific request mapping exists.
- Provider conformance records the `cohere` family, OpenAI-compatible protocol, `max_tokens`, OpenAI-format tools, source-backed Command A+ model metadata, and the `cohere-reasoning-effort` request shape.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=cohere-provider-compatibility`.

### Cerebras Chat Tools Structured Outputs And Reasoning

This slice covers the current Cerebras Inference public shared-endpoint boundary.

- Official Cerebras docs are mapped for Bearer authentication, OpenAI-compatible base URL, `/v1/chat/completions`, streaming, function tools, structured outputs, reasoning controls, `/v1/models`, model cards, errors, rate limits, and deprecations.
- The preset keeps documented `/v1/models`, OpenAI-format tools, structured output compatibility, and model-specific reasoning controls enabled.
- The preset does not claim public shared-endpoint vision, generic file attachments, chat audio input, audio transcription, speech output, embeddings, rerank, or OpenAI Responses routing.
- Structured-output requests emit OpenAI-compatible `response_format` for JSON object/schema output; strict JSON schema preserves `strict: true` when the caller requests it.
- Chat requests use the official `max_completion_tokens` field and avoid generic `max_tokens`.
- GPT OSS 120B exposes `reasoning_effort: low | medium | high`; oversized IsleMind effort values map down to `high`, and unsupported `none` is omitted.
- Z.ai GLM 4.7 exposes only `reasoning_effort: none` to disable default reasoning; unsupported active efforts are omitted rather than converted into `none`.
- Assistant reasoning replay uses the documented `reasoning` field instead of the `reasoning_content` field used by other OpenAI-compatible reasoning providers.
- Provider conformance records the `cerebras` family, OpenAI-compatible protocol, `max_completion_tokens`, text-only input, OpenAI-format tools, source-backed public model metadata, and the `cerebras-reasoning-effort` request shape.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=cerebras-provider-compatibility`.

### SambaNova Chat Responses Vision And Reasoning

This slice covers the default SambaCloud boundary behind `https://api.sambanova.ai/v1`.

- Official SambaNova docs are mapped from the current Mintlify `.md` sources for OpenAI compatibility, Chat Completions, function calling, Responses, vision, SambaCloud models, `/v1/models`, errors, rate limits, and deprecations.
- The preset keeps documented `/v1/models`, OpenAI-format tools, structured output compatibility, base64 `image_url` vision, and GPT OSS reasoning controls enabled.
- Chat Completions remains the default route; `/v1/responses` is used only when model metadata explicitly selects the Responses endpoint.
- Structured-output requests emit OpenAI-compatible JSON object/schema `response_format`; `strict: true` is intentionally omitted because SambaNova accepts the field without a stronger behavior guarantee.
- Chat requests use `max_tokens`; `max_completion_tokens` is intentionally avoided by the default request builder even though the schema accepts both fields.
- GPT OSS 120B exposes `reasoning_effort: low | medium | high`; oversized IsleMind effort values map down to `high`, `minimal` maps to `low`, and unsupported `none` is omitted.
- Assistant reasoning replay uses the documented `reasoning` field.
- The preset does not claim generic file attachments, chat audio input, audio transcription, speech output, embeddings, rerank, or native search. SambaNova audio and embeddings docs are SambaStack-only, so they are not default SambaCloud app capabilities.
- Provider conformance records the `sambanova` family, OpenAI-compatible protocol, `max_tokens`, image input, OpenAI-format tools, source-backed current docs, and the `sambanova-reasoning-effort` request shape.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=sambanova-provider-compatibility`.

### NVIDIA NIM Chat Models And Model-Specific Vision

This slice covers the conservative NVIDIA NIM boundary behind `https://integrate.api.nvidia.com/v1`.

- Official NVIDIA docs are mapped for LLM APIs, `/v1/chat/completions`, model listing, model-specific vision examples, retrieval APIs, and Build model discovery.
- The preset keeps documented `/v1/models` sync and OpenAI-compatible chat routing enabled.
- Chat requests use `max_tokens`; `max_completion_tokens`, `reasoning_effort`, `response_format`, and OpenAI Responses routing are intentionally avoided by default.
- Vision support is documented through model-specific `image_url` examples and remains tied to explicit model metadata.
- The preset does not claim generic file attachments, chat audio input, audio transcription, speech output, OpenAI-format tools, structured output, reasoning, embeddings, or rerank. NVIDIA documents retrieval APIs, but IsleMind does not claim generic embedding/rerank routing for NIM until those paths are mapped.
- Provider conformance records the `nvidia-nim` family, OpenAI-compatible protocol, `max_tokens`, image input, disabled file/audio/speech surfaces, disabled default tools/reasoning, and source-backed NVIDIA LLM API docs.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=nvidia-nim-provider-compatibility`.

### Hugging Face Router Chat Tools Structured Outputs And GPT-OSS Reasoning

This slice covers the Hugging Face Inference Providers Router boundary behind `https://router.huggingface.co/v1`.

- Official Hugging Face docs are mapped for Chat Completions, function calling, structured outputs, beta Responses API, GPT-OSS reasoning, API quicktour model listing, and `image_url` VLM chat.
- The preset keeps `/v1/models`, OpenAI-compatible chat routing, OpenAI-format tools, and model-specific vision enabled.
- Chat requests use `max_tokens`; GPT-OSS models can send `reasoning_effort: low | medium | high`, while non-GPT-OSS models do not inherit generic reasoning controls.
- Responses routing is available only when explicit model metadata selects `preferredEndpoint: responses`; the default Router path stays on Chat Completions.
- The preset does not claim generic `file_data` attachments, audio input, audio transcription, speech output, embeddings, rerank, native search, or provider-independent reasoning. Structured output remains documented in the contract, but IsleMind does not emit `response_format` controls until the app has a source-backed request path.
- Provider conformance records the `huggingface` family, OpenAI-compatible protocol, `max_tokens`, image input, OpenAI-format tools, blocked generic files, source-backed official docs, and the `huggingface-reasoning-effort` request shape for GPT-OSS fixtures.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=huggingface-provider-compatibility`.

### GitHub Models Hosted OpenAI-Compatible Inference

This slice covers the hosted GitHub Models inference boundary behind `https://models.github.ai/inference`.

- Official GitHub Models docs are mapped for the hosted model prototyping workflow and OpenAI-compatible inference base URL.
- The preset keeps `/models` sync, Chat Completions routing, Bearer token auth, and OpenAI-compatible response parsing enabled.
- Chat requests use `max_tokens`; `max_completion_tokens`, `reasoning_effort`, structured-output request controls, and OpenAI Responses routing are intentionally avoided by default.
- OpenAI-format tool declarations remain supported for tool-capable model metadata; generic file attachments, chat audio input, audio transcription, speech output, embeddings, and rerank are not claimed by the preset.
- Vision support is kept as a model-metadata path and covered with `image_url` fixtures instead of treating every listed model as multimodal.
- Provider conformance records the `github-models` family, OpenAI-compatible protocol, `max_tokens`, source-backed GitHub docs, OpenAI-format tools, model-list sync, blocked generic files, disabled default reasoning, and hosted routing.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=github-models-provider-compatibility`.

### Hosted Cloud Provider Routing

This slice covers Azure OpenAI, AWS Bedrock, and Vertex AI hosted wrappers:

- Azure OpenAI v1 resource endpoints keep `/openai/v1/chat/completions`, `/openai/v1/responses`, `/openai/v1/models`, and `api-key` auth routing aligned with Microsoft API reference docs.
- Azure OpenAI Chat Completions structured output uses documented OpenAI-compatible `response_format`; IsleMind does not add `strict` until Azure strict schema behavior is source-backed in app fixtures.
- Azure OpenAI Responses routes file/image input through the v1 Responses body and emits `reasoning: { effort }` only when model metadata declares `openai-effort` tiers.
- Azure OpenAI Responses structured-output request controls stay disabled until Microsoft docs and app fixtures source-back the Responses `text.format` or equivalent shape.
- Legacy Azure deployment-style paths remain explicit hosted gaps instead of silently falling back to the public OpenAI endpoint.
- AWS Bedrock Mantle uses the current Chat Completions hosted API path with Bedrock API-key Bearer auth, streaming, and `/v1/models`; Bedrock Runtime uses signed non-streaming InvokeModel preparation for Anthropic-style Messages payloads.
- Bedrock Responses, structured-output request controls, OpenAI-format tools, multimodal/files, reasoning controls, Runtime model-list, Runtime response streaming, Converse/ConverseStream, and account/model access remain `needs-live-smoke` boundaries.
- Vertex AI OpenAI-compatible endpoints preserve the `/v1/projects/{project}/locations/{location}/endpoints/openapi` namespace and bearer access-token auth; chat, streaming, OpenAI-format tools, `response_format`, `image_url`, and `reasoning_effort` are covered offline.
- Vertex AI automatic `/models` sync, generic OpenAI `file_data` attachments, Responses routing, native Vertex Gemini paths, and native payload mapping remain planned/manual until project/location routing and live smoke evidence are available.
- Provider conformance records `azure-openai`, `aws-bedrock`, and `vertex-ai` hosted families with source-backed Microsoft, AWS, and Google Cloud docs instead of collapsing the manifests into generic compatible providers.
- Azure OpenAI focused verification: `node scripts/provider-intelligence-tests.js --focus=azure-openai-provider-compatibility`.
- AWS Bedrock focused verification: `node scripts/provider-intelligence-tests.js --focus=aws-bedrock-provider-compatibility`.
- Vertex AI focused verification: `node scripts/provider-intelligence-tests.js --focus=vertex-ai-provider-compatibility`.
- Focused hosted verification: `node scripts/provider-intelligence-tests.js --focus=provider-hosted-compatibility`.

### DeepInfra OpenAI-Compatible Chat Vision Reasoning And Embeddings

This slice covers the DeepInfra OpenAI-compatible route behind `https://api.deepinfra.com/v1/openai`.

- Official DeepInfra docs are mapped for Chat Completions, streaming, tool calling, structured outputs, vision, reasoning, embeddings, model metadata, rate limits, native rerank, speech recognition, and text-to-speech.
- The preset keeps `/v1/openai/models`, `/v1/openai/chat/completions`, `/v1/openai/embeddings`, Bearer token auth, OpenAI-compatible response parsing, OpenAI-format tools, and `image_url` vision enabled.
- Chat requests use `max_tokens`; source-backed reasoning models can send `reasoning_effort: none | low | medium | high`, while non-reasoning models do not inherit generic reasoning controls.
- Model sync maps DeepInfra metadata tags such as `vlm`, `vision`, `reasoning_effort`, and `reasoning` into model-level capability metadata.
- The preset does not claim generic `file_data` attachments, chat audio input, OpenAI Responses routing, native speech recognition, native text-to-speech, or native rerank until IsleMind routes the documented `/v1/inference/{model_name}` endpoints.
- Provider conformance records the `deepinfra` family, OpenAI-compatible protocol, `max_tokens`, OpenAI-format tools, image input, blocked generic files/audio/speech, source-backed official docs, and the `deepinfra-reasoning-effort` request shape.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=deepinfra-provider-compatibility`.

### Novita OpenAI-Compatible Chat Vision Tools And Reasoning Content

This slice covers the Novita OpenAI-compatible route behind `https://api.novita.ai/openai`.

- Official Novita docs are mapped for LLM API base URL, Chat Completions, model listing, embeddings, rerank, function calling, structured outputs, vision, reasoning output, and error codes.
- The preset normalizes the official SDK base to `/openai/v1` for chat, model discovery, and embeddings. Legacy `/v3/openai` user-entered URLs remain detected and route-compatible.
- Chat requests use `max_tokens`; OpenAI-format tools and `image_url` vision are enabled. `reasoning_content` is parsed from non-streaming and streaming responses, but request-side `reasoning_effort` and `separate_reasoning` controls are not emitted by default.
- Model sync maps Novita remote metadata fields including `context_size`, `max_output_tokens`, `features`, and `input_modalities` into context/output limits, tool support, and vision support.
- The preset does not claim generic `file_data` attachments, chat audio input, audio transcription, speech output, OpenAI Responses routing, or native rerank until IsleMind routes those documented surfaces.
- Provider conformance records the `novita` family, OpenAI-compatible protocol, `max_tokens`, OpenAI-format tools, image input, blocked generic files/audio/speech, disabled request-side reasoning controls, and source-backed official docs.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=novita-provider-compatibility`.

### SiliconFlow OpenAI-Compatible Chat Tools Vision And Thinking Budget

This slice covers the SiliconFlow OpenAI-compatible route behind `https://api.siliconflow.cn/v1`.

- Official SiliconFlow docs are mapped for Chat Completions, model listing, embeddings, rerank, multimodal vision, reasoning models, Function Calling, JSON mode, streaming, error codes, rate limits, and text-to-speech.
- The preset keeps `/v1/chat/completions`, authenticated `/v1/models`, `/v1/embeddings`, Bearer auth, OpenAI-compatible response parsing, OpenAI-format tools, and `image_url` vision enabled.
- Reasoning-capable SiliconFlow models use the provider-documented `thinking_budget` request field and parse response-side `reasoning_content`. The request body avoids DashScope-specific `enable_thinking` and OpenAI-style `reasoning_effort`.
- Model sync preserves standard OpenAI-compatible model list metadata such as `context_length`, `max_tokens`, tags, and function-calling features.
- The preset does not claim generic `file_data` attachments, chat audio/video input, OpenAI Responses routing, native rerank, text-to-speech, or multimodal embedding/rerank routing until IsleMind routes those documented endpoints.
- Provider conformance records the `siliconflow` family, OpenAI-compatible protocol, `max_tokens`, OpenAI-format tools, image input, blocked generic files/audio/speech, source-backed official docs, and the `siliconflow-thinking-budget` request shape.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=siliconflow-provider-compatibility`.

### ModelScope API-Inference OpenAI-Compatible Chat And Model Sync

This slice covers the ModelScope API-Inference route behind `https://api-inference.modelscope.cn/v1`.

- Official ModelScope API-Inference docs are mapped for the API introduction and Chat Completion reference; live API endpoint evidence is mapped for `/v1/models`, `/v1/chat/completions`, and `/v1/embeddings`.
- The preset keeps chat, streaming, `/v1/models`, `/v1/embeddings`, Bearer auth diagnostics, OpenAI-compatible response parsing, and `max_tokens` enabled.
- ModelScope Qwen/DeepSeek model names are isolated from DashScope detection, so requests do not emit `enable_thinking`, `thinking_budget`, `stream_options.include_usage`, or unsupported generic `reasoning_effort`.
- Model sync preserves the live OpenAI-compatible model list ids without inferring vision, tools, or reasoning from model names alone.
- The preset does not claim generic `file_data` attachments, image input, chat audio input, audio transcription, speech output, OpenAI Responses routing, structured-output request controls, reasoning controls, or OpenAI-format tools until source-backed ModelScope fixtures exist.
- Provider conformance records the `modelscope` family, OpenAI-compatible protocol, `max_tokens`, blocked generic image/file/audio/speech input, no request-side reasoning controls, no default tool declarations, and source-backed official docs.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=modelscope-provider-compatibility`.

### Volcengine Ark Chat Tools Vision And Model Sync

This slice covers the Volcengine Ark / Doubao route behind `https://ark.cn-beijing.volces.com/api/v3`.

- Current official Ark docs are mapped through `docs/82379/1494384` for Chat API, `1330310` for model list, `1262342` for Function Calling, `1362931` for image understanding, `1848593` for rate-limit behavior, and `1350667` for model deprecation. The older `1298454` and `1263482` pages are not used as current evidence.
- The preset keeps chat, streaming, `/api/v3/models`, Bearer auth, OpenAI-compatible response parsing, `max_tokens`, OpenAI-format provider tools, and `image_url` vision enabled.
- The preset does not claim generic `file_data` attachments, chat audio input, audio transcription, speech output, OpenAI Responses routing, structured-output request controls, or reasoning controls until source-backed Ark runtime fixtures exist.
- Model sync preserves Ark model ids, context limits, output-token limits, and vision modality metadata without inferring unsupported files, audio, Responses, or reasoning behavior.
- Provider conformance records the `volcengine-ark` family, OpenAI-compatible protocol, `max_tokens`, image input support, blocked generic file/audio/speech input, no request-side reasoning controls, OpenAI-format tool declarations, and source-backed current official docs.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=volcengine-ark-provider-compatibility`.

### OpenRouter Relay Routing

This slice covers the OpenRouter aggregator route behind `https://openrouter.ai/api/v1`.

- Official OpenRouter docs are mapped for Chat Completions, Responses, model listing, structured outputs, PDF inputs, provider routing, and tool calling.
- Chat routes preserve the configured relay base URL and `/chat/completions` path.
- Responses routing stays opt-in and requires the provider capability `responsesApi`; the default route remains Chat Completions.
- Structured-output requests emit top-level `response_format` on both Chat Completions and explicit Responses routes.
- PDF attachments use the documented Chat Completions `type: "file"` content part with `file.filename` and `file.file_data` data URLs; parser plugins and annotation replay remain planned until IsleMind has provider-specific controls for them.
- `/api/v1/models` `supported_parameters` are preserved in model metadata; when a synced model explicitly omits `response_format` / `structured_outputs`, provider conformance blocks structured-output requests instead of sending unsupported payloads.
- Provider tool declarations survive both Chat Completions and Responses request bodies.
- Model sync calls `/models` and preserves context, output-token, and vision metadata without flattening upstream capabilities.
- OpenAI-compatible JSON and SSE response parsing preserve text, usage, retrieval citations, and streamed tool-call arguments.
- Relay HTTP errors classify rate limits and preserve provider request ids for diagnostics.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=openrouter-provider-compatibility`.
- Relay family verification: `node scripts/provider-intelligence-tests.js --focus=provider-relay-compatibility`.

### NewAPI And Sub2API Relay Routing

This slice covers the conservative NewAPI and Sub2API relay boundary:

- NewAPI's old English docs paths are stale; current evidence comes from `https://docs.newapi.pro/zh/docs/api`, ChatCompletions, Responses, Models, and the unimplemented Files page.
- NewAPI documents OpenAI-compatible `/v1/chat/completions`, `/v1/responses`, `/v1/models`, Bearer auth, `stream`, `tools` / `tool_calls`, Chat `response_format`, Chat `reasoning_effort`, Responses `reasoning`, and 400/429 error responses.
- NewAPI's Files page documents `/v1/files` as not implemented with a 501 response, so IsleMind does not claim generic `file_data` support for the preset.
- The NewAPI ChatCompletions page does not provide provider-wide chat `image_url` evidence in this audit, so unknown relay models wait for `/models` metadata, known catalog entries, or manual capability declaration before claiming vision input.
- NewAPI Chat Completions structured output is request-controlled through OpenAI-compatible `response_format` with offline schema-body, conformance, and route-decision fixtures. Responses structured-output request controls stay blocked until the NewAPI Responses docs source-back a schema field such as `text.format` or `response_format`.
- NewAPI reasoning controls are enabled only when model metadata declares an OpenAI-style effort profile: Chat uses `reasoning_effort`, while explicit Responses routing uses `reasoning: { effort }`.
- Sub2API's public site currently exposes only a minimal AI API Gateway page; the current public source is `https://github.com/Wei-Shaw/sub2api`, whose README proves relay/account distribution, generated API keys, request forwarding, load balancing, configurable rate limits, and Claude/OpenAI/Gemini/Antigravity subscription unification.
- The current Sub2API README does not document OpenAI-compatible `/v1/chat/completions`, `/v1/responses`, `/v1/models`, `response_format`, `reasoning_effort`, or `tool_calls` payload contracts, so IsleMind treats those as relay declarations rather than provider-wide preset guarantees.
- Chat routes preserve the configured relay base URL and `/chat/completions` path.
- Relays can opt into `/responses` only when `responsesApi` is explicitly declared.
- Provider conformance now reports `openai-responses` when runtime routing selects Responses for a named relay family.
- Provider tool declarations survive Chat Completions and explicitly declared Responses request bodies; Sub2API keeps that as pass-through behavior rather than a guarantee of every upstream supplier's native tool semantics.
- Model sync calls each relay `/models` endpoint and preserves context, output-token, and vision metadata without flattening upstream capabilities.
- NewAPI and Sub2API default presets no longer claim generic file attachments or provider-wide chat vision; Sub2API also avoids default `response_format` and `reasoning_effort` claims. Model metadata, known catalog entries, or explicit user declarations can still declare upstream model capabilities.
- OpenAI-compatible JSON and SSE response parsing preserve text, usage, retrieval citations, and streamed tool-call arguments.
- Relay HTTP errors classify rate limits and preserve provider request ids for diagnostics.
- NewAPI is `conformance-ready` for the documented relay surfaces above; Sub2API remains `docs-mapped` until endpoint-level provider documentation is stronger than the project README.
- NewAPI focused verification: `node scripts/provider-intelligence-tests.js --focus=newapi-provider-compatibility`.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=provider-relay-compatibility`.

### Local OpenAI-Compatible Runtime Routing

The current local runtime slice covers Ollama, LM Studio, LocalAI, vLLM, and SGLang:

- Chat routes preserve the configured local OpenAI-compatible base URL and `/chat/completions` path.
- Local runtimes remain `protocol-reference` entries because installed model capability is local machine state.
- Provider conformance records the runtime family instead of collapsing every local service into an anonymous compatible endpoint.
- Runtime manifests link back to official local runtime protocol documentation.
- Model sync calls each local `/models` endpoint and preserves context, output-token, and vision metadata.
- Ollama evidence now uses current `docs.ollama.com` Markdown docs instead of the retired GitHub `docs/openai.md` path.
- Ollama maps `/v1/chat/completions`, `/v1/responses`, `/v1/models`, `/v1/embeddings`, native `/api/chat`, and native `/api/embed`.
- Ollama Chat Completions structured output uses OpenAI-compatible top-level `response_format`, and streaming Chat requests include the documented `stream_options.include_usage` field.
- Ollama Responses routing remains explicit through `responsesApi` plus model metadata `preferredEndpoint: responses`; current Ollama OpenAI compatibility docs list non-stateful Responses, streaming, tools, and reasoning summaries but do not list `response_format`, so structured-output requests on Responses are blocked by conformance until that field is source-backed.
- Ollama reasoning uses OpenAI-compatible `reasoning_effort` only when model metadata declares `openai-effort` tiers, so a generic local model name does not silently enable reasoning controls.
- Ollama provider embeddings use `/v1/embeddings` and require a configured local embedding model such as `nomic-embed-text`; live execution remains env-gated because the model must be installed locally.
- LM Studio evidence now uses current Developer docs under `https://lmstudio.ai/docs/developer/openai-compat.md` instead of the older app API pages.
- LM Studio maps `/v1/chat/completions`, `/v1/responses`, `/v1/models`, `/v1/embeddings`, and `/v1/completions`.
- LM Studio Chat Completions structured output uses OpenAI-compatible `response_format` with JSON Schema and `strict` when the selected local model/template supports it; streaming Chat requests include documented `stream_options.include_usage`.
- LM Studio tool use is covered for both Chat Completions and Responses through OpenAI-format `tools` / `tool_calls`, but actual reliability remains loaded-model and prompt-template state.
- LM Studio Responses routing remains explicit through `responsesApi` plus model metadata `preferredEndpoint: responses`; Responses reasoning uses `reasoning: { effort }` when model metadata declares `openai-effort` tiers.
- LM Studio Responses structured-output request controls are not emitted yet because the current docs only source-back structured output on Chat Completions; requests that combine Responses with structured output are blocked by conformance with an explicit unsupported capability issue.
- LM Studio provider embeddings use `/v1/embeddings` and require a configured local embedding model; live execution remains env-gated because the model must be loaded locally.
- LocalAI maps current Quickstart, Text Generation, OpenAI Functions and Tools, Constrained Grammars, Embeddings, Audio to Text, and Text to Audio docs, including `/v1/chat/completions`, `/v1/models`, `/v1/embeddings`, `/v1/audio/transcriptions`, and `/v1/audio/speech`.
- LocalAI structured output is source-backed as grammar-constrained output through `grammar` / `grammar_json_functions`, not through IsleMind's current OpenAI `response_format` planner; structured-output requests stay blocked until a LocalAI grammar planner exists.
- LocalAI provider embeddings use the configured OpenAI-compatible base URL plus `/embeddings` and require a configured local embedding model; live execution remains env-gated because the backend and model must be installed locally.
- LocalAI transcription and speech routes use the OpenAI-compatible `/audio/transcriptions` and `/audio/speech` endpoints when the local audio backends are configured.
- vLLM evidence now uses current `https://docs.vllm.ai/en/latest/serving/online_serving/` docs instead of the redirected `openai_compatible_server` page.
- vLLM maps `/v1/completions`, `/v1/chat/completions`, `/v1/chat/completions/batch`, `/v1/responses`, `/v1/models`, `/v1/embeddings`, `/v1/audio/transcriptions`, `/v1/audio/translations`, `/v1/score`, `/v1/rerank`, and `/pooling`.
- vLLM Chat Completions structured output uses OpenAI-compatible `response_format`; IsleMind does not add `strict` until vLLM strict schema behavior is source-backed in app fixtures.
- vLLM tool use is covered through OpenAI-format `tools` / `tool_choice` / `tool_calls`, while actual auto tool parsing still depends on server flags such as `--enable-auto-tool-choice` and `--tool-call-parser`.
- vLLM Chat reasoning uses `reasoning_effort` and explicit Responses routing uses `reasoning: { effort }` only when model metadata declares `openai-effort` tiers.
- vLLM Responses routing remains explicit through `responsesApi` plus model metadata `preferredEndpoint: responses`; Responses structured-output request controls are not emitted yet and incompatible requests are blocked by conformance.
- vLLM provider embeddings use `/v1/embeddings` and require a served embedding model. ASR, score/rerank, and pooling endpoints are mapped as official evidence but stay unclaimed until IsleMind has dedicated app routing and fixtures.
- SGLang evidence now uses current `docs.sglang.io` pages instead of the stale `docs.sglang.ai/backend/*.html` links.
- SGLang maps `/v1/completions`, `/v1/chat/completions`, `/v1/models`, and `/v1/embeddings`.
- SGLang Chat Completions structured output uses OpenAI-compatible `response_format` JSON Schema; IsleMind does not add `strict` until strict behavior is source-backed in app fixtures.
- SGLang tool use is covered through OpenAI-format `tools`, `tool_choice`, and `tool_calls`, while actual parsing depends on served model and server options such as `--tool-call-parser`.
- SGLang vision is documented through OpenAI-compatible `image_url` message parts, but runtime support still depends on the served VLM and model metadata.
- SGLang reasoning evidence covers separate reasoning-output parsing with offline fixtures for non-streaming `message.reasoning_content` and streaming `delta.reasoning_content`; IsleMind does not emit `extra_body.separate_reasoning` or other request-side reasoning controls for SGLang yet.
- SGLang provider embeddings use `/v1/embeddings` and require a served embedding model. Responses, audio, rerank, diffusion/image generation, and other non-chat native endpoints remain unclaimed until app routing and fixtures exist.
- OpenAI-compatible JSON and SSE response parsing preserve text, usage, retrieval citations, and streamed tool-call arguments.
- Missing local models classify as `model_unavailable` and preserve request ids for diagnostics.
- Ollama focused verification: `node scripts/provider-intelligence-tests.js --focus=ollama-provider-compatibility`.
- LM Studio focused verification: `node scripts/provider-intelligence-tests.js --focus=lm-studio-provider-compatibility`.
- LocalAI focused verification: `node scripts/provider-intelligence-tests.js --focus=localai-provider-compatibility`.
- vLLM focused verification: `node scripts/provider-intelligence-tests.js --focus=vllm-provider-compatibility`.
- SGLang focused verification: `node scripts/provider-intelligence-tests.js --focus=sglang-provider-compatibility`.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=provider-local-runtime-compatibility`.

### Custom Compatible Endpoint Declaration

This slice covers user-entered OpenAI-compatible and Anthropic-compatible endpoints that are not an official provider, named relay, hosted cloud wrapper, or local runtime preset:

- `custom-openai-compatible` and `custom-anthropic-compatible` remain `protocol-reference` evidence entries backed by the OpenAI Chat/Responses protocol docs and Anthropic Messages protocol docs.
- Default custom presets are text-first: provider-native tools, structured output, image input, file input, reasoning controls, Responses routing, audio, speech, and native web search stay off until declared, probed, or manually configured.
- OpenAI-compatible chat routes preserve the configured base URL and `/chat/completions`; Responses routes preserve the same base URL and `/responses` only after `responsesApi` plus model metadata select the Responses endpoint.
- Custom Anthropic-compatible presets preserve the configured base URL and `/messages`, while explicit Anthropic wire-protocol providers record the `anthropic-compatible` conformance family.
- Conformance blocks undeclared image/file attachments and omits undeclared provider tool declarations instead of silently treating a custom endpoint as a fully capable official provider.
- Static model ids such as Qwen, Kimi, or Sonar names do not enable tools, image/file input, or provider-specific reasoning shapes for legacy custom endpoints that have no explicit capability declarations.
- Remote model metadata or manual capability declarations can enable tools, vision, files, and Responses routing for a specific custom endpoint without changing the conservative defaults for unknown endpoints.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=provider-custom-compatible-compatibility`.

### Live Smoke Gate Contract

This slice makes live-smoke readiness explicit without running live requests during offline tests:

- `providerCompatibilityContract.ts` now records `liveSmoke` gates for hosted accounts, relay accounts, local runtimes, and custom endpoints.
- `scripts/provider-compatibility-live-smoke-plan.js` consumes those gates and writes a plan-only result to `test-evidence/qa/provider-compatibility-live-smoke-plan.json`; it records env names, ready/skipped state, and skip reasons without serializing credential values.
- `needs-live-smoke`, `docs-mapped`, and `protocol-reference` providers must have at least one gate with required env vars, validation scope, and a skip reason.
- Azure OpenAI and Xiaomi MiMo also keep optional gates because their offline conformance is ready, but account/model behavior still depends on user credentials.
- AWS Bedrock separates Mantle API-key smoke from Runtime SigV4 `InvokeModel` smoke so Runtime streaming, Converse, and account/model access remain unclaimed until live evidence exists.
- Sub2API smoke requires `ISLEMIND_SUB2API_BASE_URL`, `ISLEMIND_SUB2API_API_KEY`, and `ISLEMIND_SUB2API_MODEL`; supplier capabilities remain source-of-truth in Sub2API and are not flattened into IsleMind presets.
- Local runtime smoke requires an explicit base URL and model env per runtime, such as `ISLEMIND_OLLAMA_BASE_URL` plus `ISLEMIND_OLLAMA_MODEL`, because installed model capability is local state.
- Plan verification: `node scripts/provider-compatibility-live-smoke-plan.js --self-test`.
- Plan collection: `bun run test:provider-live-smoke:plan`.
- Focused contract verification: `node scripts/provider-intelligence-tests.js --focus=provider-compatibility-contract`.

### Google Gemini GenerateContent Structured Outputs

This slice covers Gemini JSON/schema request controls on the native `generateContent` path.

- Official Gemini structured-output docs and API reference back JSON output through `generationConfig.responseMimeType: "application/json"` and `generationConfig.responseSchema`.
- IsleMind maps `structuredOutput: { type: "json_object" }` to JSON MIME type without a schema, and `structuredOutput: { type: "json_schema" }` to JSON MIME type plus `responseSchema`.
- The conformance manifest reports `documentedRequestShape: "google-response-schema"`, `appRequestControl: true`, `jsonObjectMode: true`, and `strictJsonSchema: false`.
- Route decisions expose the accepted Gemini schema request through `structuredOutputPlan` instead of treating it as an unsupported `response_format`.
- Offline verification is covered by the provider preset behavior test; optional live smoke remains separate because model-specific schema behavior depends on the active Gemini model and account.

### Structured Output Contract Visibility

This slice makes JSON/schema support visible and gates request behavior by provider contract:

- Provider conformance now exposes `manifest.structuredOutput.contractClaimed`, `documentedRequestShape`, `appRequestControl`, `jsonObjectMode`, and `strictJsonSchema`.
- `contractClaimed` follows `providerCompatibilityContract.ts` behavior evidence instead of static model ids, so protocol-reference custom endpoints remain text-first unless the provider contract explicitly claims structured output.
- `documentedRequestShape` records the provider API family shape (`openai-response-format`, `openai-json-object-response-format`, `openrouter-response-format`, `xai-response-format`, `anthropic-tool-schema`, or `google-response-schema`) only when the compatibility contract claims structured output.
- `appRequestControl` remains `false` by default; Google Gemini now has source-backed native `generationConfig` schema controls, DeepSeek has source-backed JSON object mode, OpenRouter has source-backed `response_format` controls gated by `supported_parameters`, xAI has source-backed `response_format` controls on Responses and Chat routes, Ollama and NewAPI have source-backed Chat Completions `response_format` controls, while Cerebras and SambaNova have source-backed OpenAI-compatible Chat Completions `response_format` request controls.
- Gemini emits `generationConfig.responseMimeType` / `responseSchema`; it does not use OpenAI `response_format` and does not claim a strict-schema flag.
- DeepSeek emits `response_format: { "type": "json_object" }` for JSON object requests and blocks JSON Schema requests until official docs document a schema request shape.
- OpenRouter emits `response_format` for Chat Completions and explicit Responses requests, but synced model metadata can disable the control when `supported_parameters` omits structured-output parameters.
- xAI emits top-level `response_format` for Responses and Chat Completions requests; it does not use OpenAI Responses `text.format`.
- Cerebras preserves `strict: true` for JSON schema requests. SambaNova emits the schema but omits `strict` because the official docs accept the field without making it a stronger guarantee.
- Providers without `appRequestControl` remove accidental `response_format` payloads and surface `unsupported_structured_output` as a blocking conformance issue when a caller asks for structured output.
- Route decisions expose `structuredOutputPlan` with requested/supported/request-shape/strict/block state, so runtime logs can explain both accepted and blocked schema requests.
- Runtime fallback treats `structured_output` as a required capability and only keeps fallback candidates whose provider conformance manifest exposes structured-output request controls.
- Provider capability matrix diagnostics include a `structuredOutput` area so Settings diagnostics can report documented-but-not-request-controlled providers instead of silently implying full schema output support.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=provider-compatibility-contract`.
- Focused provider verification: `node scripts/provider-intelligence-tests.js --focus=cerebras-provider-compatibility`, `node scripts/provider-intelligence-tests.js --focus=sambanova-provider-compatibility`, `node scripts/provider-intelligence-tests.js --focus=mistral-provider-compatibility`, and `node scripts/provider-intelligence-tests.js --focus=provider-presets`.

### Runtime Diagnostics Contract Consumption

This slice connects provider compatibility evidence to runtime observability and settings diagnostics:

- Chat request assembly writes a `provider.compatibility` runtime-log event next to route, conformance, payload, proxy, and upstream request events.
- Chat message traces include a `provider-compatibility-contract` system trace before the provider request, so users and support diagnostics can see the selected contract audit state without opening the log file.
- Runtime compatibility log data records the compatibility evidence id, audit state, protocol, behavior axes, endpoint families, official-doc count, live-smoke gate ids, and required env names without serializing credential values.
- Runtime fallback requests also log the selected fallback provider's compatibility evidence before conformance logging.
- RAG provider embeddings are attempted only when the selected provider's compatibility evidence claims `embeddings`; unsupported custom/relay/chat-only providers stay on local fallback vectors and emit `knowledge_embedding/provider_embedding_unsupported_by_contract`.
- Provider-native IsleMind tool declarations are exposed only when compatibility evidence claims `tools` or the provider has an explicit/manual `nativeTools` declaration; custom compatible endpoints cannot inherit tool support solely from a known model id.
- Provider-native IsleMind tool declarations skipped because compatibility evidence does not claim `tools` emit a skipped chat trace and a `provider.compatibility` runtime-log entry with `provider_native_tools_skipped_by_contract`.
- The chat model picker uses the same provider-native tool support decision for its `tools` capability badge, so custom compatible models are not labeled tool-capable unless their provider contract or explicit provider settings allow it.
- The chat model picker also gates its `vision` capability badge through compatibility evidence, explicit provider declarations, or remote model metadata; known model ids alone do not make protocol-reference custom endpoints appear image-capable.
- Reasoning controls use compatibility evidence, explicit provider declarations, or remote model metadata before exposing effort tiers; known reasoning-capable model ids alone do not enable reasoning controls for protocol-reference custom endpoints.
- System prompt capability hints use the same provider-aware vision and file checks, so protocol-reference custom endpoints are not told they can process images or files from known model ids alone.
- Provider-native search is sent only when `providerCompatibilityContract` exposes `nativeSearch` for the selected provider identity, or a protocol-reference/custom endpoint explicitly declares `nativeSearch`; a user setting of native search by itself leaves request `webSearchMode` off and records `provider_native_search_unclaimed` in trace metadata.
- Provider conformance applies the same text-first rule to protocol-reference custom endpoints: static model catalog capabilities are disabled unless the provider explicitly declares the capability or remote model metadata backs it.
- Provider conformance surfaces structured-output contract state separately from runtime request controls, so providers with JSON/schema docs do not receive `response_format` until app wiring exists; Cerebras and SambaNova are the first source-backed OpenAI-compatible request-control slice.
- Provider conformance blockers stop the upstream request and map to localized user-facing copy instead of exposing raw `provider_conformance_blocked:*` internal codes.
- Runtime fallback derives required tools and native-search capabilities from the original request, then rejects fallback candidates whose provider contract or explicit custom endpoint declaration does not expose the matching `tools` or `native_search` capability.
- Runtime fallback also derives `structured_output` from the original request and rejects fallback candidates without source-backed structured-output request controls.
- OpenAI-compatible Responses routing, Responses WebSocket transport, and remote compact require both provider settings capability flags and matching `providerCompatibilityContract` capabilities; custom/protocol-reference endpoints must explicitly declare these before runtime can use `/responses`, WebSocket, or server-side compaction paths.
- Settings runtime diagnostics summarize provider compatibility audit states and live-smoke gate counts through `buildRuntimeDiagnosticsSummary`.
- The Settings diagnostics panel shows a provider contract row with conformance-ready, docs-mapped, needs-live-smoke, protocol-reference, gate, and logged-event counts.
- Focused verification: `node scripts/provider-intelligence-tests.js --focus=runtime-log`.
- Focused UI/summary verification: `node scripts/provider-intelligence-tests.js --focus=runtime-health-log`.
- Focused contract trace verification: `node scripts/provider-intelligence-tests.js --focus=provider-compatibility-contract`.

## Completion Bar

The full goal is not complete until every current and planned provider has:

- A provider compatibility evidence entry with official docs.
- Model catalog source URLs for built-in model metadata.
- Runtime request shaping that follows the documented endpoint and payload shape.
- Stream, tool-call, structured-output, multimodal, reasoning, error, retry, and rate-limit behavior either implemented or explicitly marked unsupported/partial.
- Context-limit, system-prompt, safety-policy, and retry-policy behavior represented in the executable contract.
- Offline conformance tests for every declared behavior.
- Optional live smoke results recorded for providers that require real credentials, region, project, or local runtime state.
