import type { AIModel, AIProvider, ProviderPresetId, ProviderType, ProviderWireProtocol } from '@/types'

export type ProviderCompatibilityAuditState =
  | 'conformance-ready'
  | 'docs-mapped'
  | 'needs-live-smoke'
  | 'protocol-reference'

export type ProviderCompatibilityCapabilityStatus =
  | 'supported'
  | 'partial'
  | 'unsupported'
  | 'requiresLiveKey'
  | 'docsChanged'

export type ProviderCompatibilityLimitationReason =
  | 'contract_supported'
  | 'contract_partial'
  | 'contract_unclaimed'
  | 'live_smoke_required'
  | 'docs_changed'

export type ProviderCompatibilityDegradationPath =
  | 'send_allowed'
  | 'disable_parameter'
  | 'run_live_smoke'
  | 'manual_declaration_or_model_metadata'
  | 'local_fallback'
  | 'refresh_docs'

export type ProviderCompatibilityCapabilitySendSource =
  | 'contract'
  | 'provider_identity'
  | 'explicit_declaration'
  | 'blocked'

export interface ProviderCompatibilityCapabilityExplanation {
  limitationReason: ProviderCompatibilityLimitationReason
  degradationPath: ProviderCompatibilityDegradationPath
}

export interface ProviderCompatibilityCapabilitySendPolicy extends ProviderCompatibilityCapabilityExplanation {
  behavior: ProviderCompatibilityBehavior
  compatibilityId: ProviderPresetId
  auditState: ProviderCompatibilityAuditState
  status: ProviderCompatibilityCapabilityStatus
  allowed: boolean
  sendSource: ProviderCompatibilityCapabilitySendSource
}

export type ProviderCompatibilityBehavior =
  | 'auth'
  | 'chat'
  | 'streaming'
  | 'responsesApi'
  | 'responsesWebSocket'
  | 'remoteCompact'
  | 'contextLimit'
  | 'systemPromptPolicy'
  | 'safetyPolicy'
  | 'tools'
  | 'structuredOutput'
  | 'nativeSearch'
  | 'vision'
  | 'audio'
  | 'files'
  | 'reasoning'
  | 'embeddings'
  | 'rerank'
  | 'modelList'
  | 'errors'
  | 'rateLimits'
  | 'retryPolicy'
  | 'deprecation'
  | 'citations'
  | 'localRuntime'
  | 'hostedRouting'
  | 'relayRouting'

export type ProviderCompatibilityLiveSmokeKind =
  | 'hosted-account'
  | 'relay-account'
  | 'local-runtime'
  | 'custom-endpoint'

export interface ProviderCompatibilityLiveSmokeGate {
  id: string
  kind: ProviderCompatibilityLiveSmokeKind
  requiredEnv: readonly string[]
  validates: readonly ProviderCompatibilityBehavior[]
  skippedWithout: string
}

export interface ProviderCompatibilityLiveSmokeStatus {
  gate: ProviderCompatibilityLiveSmokeGate
  ready: boolean
  missingEnv: readonly string[]
}

export interface ProviderCompatibilityEvidenceProviderLike {
  id?: string
  type?: ProviderType
  presetId?: ProviderPresetId
  detectedPresetId?: ProviderPresetId
  wireProtocol?: ProviderWireProtocol
}

export interface ProviderCompatibilityEvidence {
  id: ProviderPresetId
  protocol:
    | 'openai-responses'
    | 'openai-chat-completions'
    | 'anthropic-messages'
    | 'google-generate-content'
    | 'openai-compatible'
    | 'anthropic-compatible'
    | 'local-openai-compatible'
    | 'hosted-openai-compatible'
    | 'hosted-native'
  officialDocs: readonly string[]
  endpointFamilies: readonly string[]
  behaviorDocs: readonly ProviderCompatibilityBehavior[]
  behaviorStatusOverrides?: Partial<Record<ProviderCompatibilityBehavior, ProviderCompatibilityCapabilityStatus>>
  liveSmoke?: readonly ProviderCompatibilityLiveSmokeGate[]
  auditState: ProviderCompatibilityAuditState
  notes: string
}

export type ProviderCompatibilityBehaviorStatusMap = Record<
  ProviderCompatibilityBehavior,
  ProviderCompatibilityCapabilityStatus
>

export const CANONICAL_PROVIDER_COMPATIBILITY_BEHAVIORS = [
  'auth',
  'chat',
  'streaming',
  'responsesApi',
  'responsesWebSocket',
  'remoteCompact',
  'contextLimit',
  'systemPromptPolicy',
  'safetyPolicy',
  'tools',
  'structuredOutput',
  'nativeSearch',
  'vision',
  'audio',
  'files',
  'reasoning',
  'embeddings',
  'rerank',
  'modelList',
  'errors',
  'rateLimits',
  'retryPolicy',
  'deprecation',
  'citations',
  'localRuntime',
  'hostedRouting',
  'relayRouting',
] as const satisfies readonly ProviderCompatibilityBehavior[]

export const CORE_PROVIDER_COMPATIBILITY_BEHAVIORS = [
  'auth',
  'chat',
  'streaming',
  'contextLimit',
  'systemPromptPolicy',
  'safetyPolicy',
  'errors',
  'rateLimits',
  'retryPolicy',
] as const satisfies readonly ProviderCompatibilityBehavior[]

const COMMON_OPENAI_COMPATIBLE_BEHAVIORS = [
  ...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS,
  'tools',
  'structuredOutput',
  'vision',
  'files',
  'reasoning',
  'modelList',
  'deprecation',
] as const satisfies readonly ProviderCompatibilityBehavior[]

const COMMON_LOCAL_OPENAI_BEHAVIORS = [
  ...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS,
  'tools',
  'structuredOutput',
  'vision',
  'modelList',
  'localRuntime',
] as const satisfies readonly ProviderCompatibilityBehavior[]

const LIVE_SMOKE_HOSTED_CHAT_BEHAVIORS = [
  'auth',
  'chat',
  'streaming',
  'modelList',
  'errors',
  'rateLimits',
  'hostedRouting',
] as const satisfies readonly ProviderCompatibilityBehavior[]

const LIVE_SMOKE_RELAY_CHAT_BEHAVIORS = [
  'auth',
  'chat',
  'streaming',
  'modelList',
  'errors',
  'rateLimits',
  'relayRouting',
] as const satisfies readonly ProviderCompatibilityBehavior[]

const LIVE_SMOKE_LOCAL_CHAT_BEHAVIORS = [
  'chat',
  'streaming',
  'modelList',
  'errors',
  'localRuntime',
] as const satisfies readonly ProviderCompatibilityBehavior[]

const DECLARABLE_PROTOCOL_REFERENCE_BEHAVIORS: readonly ProviderCompatibilityBehavior[] = [
  'responsesApi',
  'remoteCompact',
  'tools',
  'structuredOutput',
  'nativeSearch',
  'vision',
  'audio',
  'files',
  'reasoning',
  'embeddings',
  'modelList',
]

const CONFORMANCE_READY_RELAY_DECLARABLE_BEHAVIORS: readonly ProviderCompatibilityBehavior[] = [
  'vision',
]

function evidence(input: ProviderCompatibilityEvidence): ProviderCompatibilityEvidence {
  return {
    ...input,
    behaviorDocs: uniqueBehaviors([...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, ...input.behaviorDocs]),
  }
}

function uniqueBehaviors(behaviors: readonly ProviderCompatibilityBehavior[]): ProviderCompatibilityBehavior[] {
  return [...new Set(behaviors)]
}

function liveSmokeGate(input: ProviderCompatibilityLiveSmokeGate): ProviderCompatibilityLiveSmokeGate {
  return input
}

export const PROVIDER_COMPATIBILITY_EVIDENCE = {
  openai: evidence({
    id: 'openai',
    protocol: 'openai-responses',
    officialDocs: [
      'https://developers.openai.com/api/docs',
      'https://platform.openai.com/docs/api-reference/responses',
      'https://platform.openai.com/docs/api-reference/embeddings/create',
      'https://platform.openai.com/docs/guides/function-calling',
    ],
    endpointFamilies: ['/v1/responses', '/v1/chat/completions', '/v1/models', '/v1/embeddings'],
    behaviorDocs: ['auth', 'chat', 'streaming', 'responsesApi', 'responsesWebSocket', 'remoteCompact', 'tools', 'structuredOutput', 'nativeSearch', 'vision', 'audio', 'files', 'reasoning', 'embeddings', 'modelList', 'errors', 'rateLimits', 'deprecation'],
    auditState: 'conformance-ready',
    notes: 'Primary Responses path; Chat Completions remains a compatibility path for older models and relays.',
  }),
  anthropic: evidence({
    id: 'anthropic',
    protocol: 'anthropic-messages',
    officialDocs: [
      'https://docs.anthropic.com/en/api/messages',
      'https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview',
      'https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-search-tool',
      'https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking',
    ],
    endpointFamilies: ['/v1/messages', '/v1/models'],
    behaviorDocs: ['auth', 'chat', 'streaming', 'tools', 'structuredOutput', 'nativeSearch', 'vision', 'files', 'reasoning', 'modelList', 'errors', 'rateLimits', 'deprecation', 'citations'],
    auditState: 'conformance-ready',
    notes: 'Native Messages request shape with thinking, tool-use, citation, and dynamic web-search branches in provider conformance.',
  }),
  google: evidence({
    id: 'google',
    protocol: 'google-generate-content',
    officialDocs: [
      'https://ai.google.dev/gemini-api/docs',
      'https://ai.google.dev/gemini-api/docs/function-calling',
      'https://ai.google.dev/gemini-api/docs/google-search',
      'https://ai.google.dev/gemini-api/docs/thinking',
    ],
    endpointFamilies: ['/v1beta/models/{model}:generateContent', '/v1beta/models'],
    behaviorDocs: ['auth', 'chat', 'streaming', 'tools', 'structuredOutput', 'nativeSearch', 'vision', 'audio', 'files', 'reasoning', 'modelList', 'errors', 'rateLimits', 'citations'],
    auditState: 'conformance-ready',
    notes: 'Native Gemini generateContent path; Vertex-hosted native routing is tracked separately under vertex-ai.',
  }),
  deepseek: evidence({
    id: 'deepseek',
    protocol: 'openai-compatible',
    officialDocs: ['https://api-docs.deepseek.com/api/create-chat-completion', 'https://api-docs.deepseek.com/guides/thinking_mode', 'https://api-docs.deepseek.com/guides/json_mode'],
    endpointFamilies: ['/chat/completions', '/models'],
    behaviorDocs: COMMON_OPENAI_COMPATIBLE_BEHAVIORS,
    auditState: 'conformance-ready',
    notes: 'OpenAI-compatible chat path with provider-specific thinking controls and JSON object output mode. JSON Schema request controls are intentionally not claimed by the DeepSeek contract.',
  }),
  dashscope: evidence({
    id: 'dashscope',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
      'https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions',
      'https://help.aliyun.com/zh/model-studio/deep-thinking',
      'https://help.aliyun.com/zh/model-studio/text-generation-model',
      'https://help.aliyun.com/zh/model-studio/qwen-omni',
      'https://help.aliyun.com/zh/model-studio/getting-started/models',
    ],
    endpointFamilies: ['/compatible-mode/v1/chat/completions'],
    behaviorDocs: COMMON_OPENAI_COMPATIBLE_BEHAVIORS.filter((behavior) => !['files', 'audio', 'modelList', 'structuredOutput'].includes(behavior)),
    auditState: 'conformance-ready',
    notes: 'OpenAI-compatible DashScope chat path with Qwen thinking, stream-usage, tools, and image_url coverage. Generic /models sync, file_data, response_format request controls, /audio/transcriptions, /audio/speech, and Qwen-Omni chat audio remain unclaimed until source-backed runtime fixtures exist.',
  }),
  moonshot: evidence({
    id: 'moonshot',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://platform.kimi.ai/docs',
      'https://platform.kimi.ai/docs/models',
      'https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model',
      'https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart',
      'https://platform.moonshot.ai/docs',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models'],
    behaviorDocs: COMMON_OPENAI_COMPATIBLE_BEHAVIORS,
    auditState: 'conformance-ready',
    notes: 'Kimi/Moonshot compatible endpoint with K2 thinking toggles, max_completion_tokens, vision attachments, tool replay, and reasoning_content preservation covered by offline conformance.',
  }),
  bigmodel: evidence({
    id: 'bigmodel',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.bigmodel.cn/cn/guide/start/model-overview',
      'https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8',
      'https://docs.bigmodel.cn/cn/api/introduction',
      'https://docs.bigmodel.cn/cn/api/rate-limit',
    ],
    endpointFamilies: ['/api/paas/v4/chat/completions'],
    behaviorDocs: COMMON_OPENAI_COMPATIBLE_BEHAVIORS.filter((behavior) => !['files', 'structuredOutput', 'reasoning', 'modelList'].includes(behavior)),
    auditState: 'conformance-ready',
    notes: 'Zhipu GLM OpenAI-compatible route; current OpenAPI covers chat, tools, JSON object output, image_url vision input, auth, errors, and rate limits. IsleMind keeps chat, streaming, tools, image_url vision, static/manual model catalog usage, and error diagnostics covered offline. Generic /models, file_data attachments, response_format request controls, and reasoning controls stay unclaimed until source-backed runtime fixtures exist.',
  }),
  minimax: evidence({
    id: 'minimax',
    protocol: 'openai-compatible',
    officialDocs: ['https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json'],
    endpointFamilies: ['/v1/chat/completions'],
    behaviorDocs: COMMON_OPENAI_COMPATIBLE_BEHAVIORS.filter((behavior) => !['files', 'modelList'].includes(behavior)),
    auditState: 'conformance-ready',
    notes: 'OpenAI-compatible route with MiniMax-specific thinking, reasoning_split, reasoning_details, max_completion_tokens, tools, image_url, and video_url coverage. Generic /models and file_data attachments stay unclaimed because the official OpenAPI only exposes chat completions.',
  }),
  xai: evidence({
    id: 'xai',
    protocol: 'openai-responses',
    officialDocs: [
      'https://docs.x.ai/overview',
      'https://docs.x.ai/docs/api-reference',
      'https://docs.x.ai/docs/guides/function-calling',
      'https://docs.x.ai/docs/guides/structured-outputs',
      'https://docs.x.ai/docs/guides/live-search',
      'https://docs.x.ai/docs/guides/reasoning',
    ],
    endpointFamilies: ['/v1/responses', '/v1/chat/completions', '/v1/models'],
    behaviorDocs: ['auth', 'chat', 'streaming', 'responsesApi', 'tools', 'structuredOutput', 'nativeSearch', 'vision', 'reasoning', 'modelList', 'errors', 'rateLimits', 'deprecation', 'citations'],
    auditState: 'conformance-ready',
    notes: 'OpenAI-compatible surface with xAI Responses, response_format structured outputs, native web_search, encrypted reasoning replay, model metadata, and reasoning-effort differences.',
  }),
  'xiaomi-mimo': evidence({
    id: 'xiaomi-mimo',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://platform.xiaomimimo.com/docs/en-US/quick-start/model',
      'https://platform.xiaomimimo.com/docs/en-US/api-reference/chat-completions',
      'https://platform.xiaomimimo.com/docs/en-US/guides/web-search',
    ],
    endpointFamilies: ['/v1/chat/completions', '/anthropic/v1/messages', '/v1/models'],
    behaviorDocs: ['auth', 'chat', 'streaming', 'tools', 'structuredOutput', 'nativeSearch', 'vision', 'audio', 'reasoning', 'modelList', 'errors', 'rateLimits', 'deprecation', 'citations'],
    liveSmoke: [
      liveSmokeGate({
        id: 'xiaomi-mimo-native-search-chat',
        kind: 'hosted-account',
        requiredEnv: ['ISLEMIND_XIAOMI_MIMO_BASE_URL', 'ISLEMIND_XIAOMI_MIMO_API_KEY', 'ISLEMIND_XIAOMI_MIMO_MODEL'],
        validates: [...LIVE_SMOKE_HOSTED_CHAT_BEHAVIORS, 'tools', 'nativeSearch', 'citations'],
        skippedWithout: 'Requires Xiaomi MiMo credentials and a model that supports the documented native web_search tool.',
      }),
    ],
    auditState: 'conformance-ready',
    notes: 'Dual OpenAI/Anthropic-compatible token-plan routing; native web_search is limited to documented chat models.',
  }),
  mistral: evidence({
    id: 'mistral',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.mistral.ai/api/',
      'https://docs.mistral.ai/llms-full.txt',
      'https://docs.mistral.ai/api/endpoint/chat',
      'https://docs.mistral.ai/api/endpoint/models',
      'https://docs.mistral.ai/api/endpoint/embeddings',
      'https://docs.mistral.ai/api/endpoint/audio/transcriptions',
      'https://docs.mistral.ai/resources/cookbooks/mistral-function_calling-function_calling',
      'https://docs.mistral.ai/resources/cookbooks/mistral-image_understanding-multimodality_meets_function_calling',
      'https://docs.mistral.ai/studio-api/knowledge-rag/embeddings',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models', '/v1/files', '/v1/embeddings', '/v1/audio/transcriptions'],
    behaviorDocs: [...COMMON_OPENAI_COMPATIBLE_BEHAVIORS.filter((behavior) => !['files', 'structuredOutput'].includes(behavior)), 'embeddings'],
    auditState: 'conformance-ready',
    notes: 'Official Mistral chat, model-list, embeddings, files, audio, tools, structured-output, vision, and reasoning docs are mapped. IsleMind enables chat, streaming, tools, image_url vision, model-list, embeddings, and Magistral thinking-chunk parsing; generic local file_data attachments, audio input/transcription routing, and reasoning-effort request controls stay unclaimed until Mistral-specific runtime mapping exists.',
  }),
  groq: evidence({
    id: 'groq',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://console.groq.com/docs/openai',
      'https://console.groq.com/docs/api-reference',
      'https://console.groq.com/docs/models',
      'https://console.groq.com/docs/rate-limits',
      'https://console.groq.com/docs/text-chat',
      'https://console.groq.com/docs/tool-use',
      'https://console.groq.com/docs/structured-outputs',
      'https://console.groq.com/docs/vision',
      'https://console.groq.com/docs/speech-to-text',
      'https://console.groq.com/docs/text-to-speech',
      'https://console.groq.com/docs/responses-api',
      'https://console.groq.com/docs/errors',
    ],
    endpointFamilies: ['/openai/v1/chat/completions', '/openai/v1/responses', '/openai/v1/models', '/openai/v1/audio/transcriptions', '/openai/v1/audio/speech'],
    behaviorDocs: [...COMMON_OPENAI_COMPATIBLE_BEHAVIORS.filter((behavior) => !['files', 'structuredOutput'].includes(behavior)), 'responsesApi', 'audio'],
    auditState: 'conformance-ready',
    notes: 'Groq OpenAI-compatible route with official Chat Completions, beta Responses, models, tools, structured outputs, image_url vision, speech-to-text, text-to-speech, reasoning_effort, errors, and rate-limit docs mapped. IsleMind enables chat, streaming, tools, image_url, model-list, Responses when model metadata selects it, audio transcription, speech, and Groq qwen3/gpt-oss reasoning_effort mapping; files and Groq Compound/web-search fields stay unclaimed until provider-specific routing exists.',
  }),
  together: evidence({
    id: 'together',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.together.ai/reference/chat-completions',
      'https://docs.together.ai/docs/inference/openai-compatibility',
      'https://docs.together.ai/docs/serverless-models',
      'https://docs.together.ai/reference/models',
      'https://docs.together.ai/reference/embeddings',
      'https://docs.together.ai/docs/function-calling',
      'https://docs.together.ai/docs/json-mode',
      'https://docs.together.ai/reference/rerank',
      'https://docs.together.ai/docs/rate-limits',
      'https://docs.together.ai/docs/error-codes',
      'https://docs.together.ai/reference/audio-transcriptions',
      'https://docs.together.ai/reference/audio-speech',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models', '/v1/embeddings', '/v1/rerank', '/v1/audio/transcriptions', '/v1/audio/speech'],
    behaviorDocs: [...COMMON_OPENAI_COMPATIBLE_BEHAVIORS.filter((behavior) => !['files', 'structuredOutput'].includes(behavior)), 'audio', 'embeddings'],
    auditState: 'conformance-ready',
    notes: 'Together OpenAI-compatible route with official chat, model-list, embeddings, rerank, function calling, JSON/schema output, image_url vision, speech-to-text, text-to-speech, GPT-OSS reasoning_effort, errors, and rate-limit docs mapped. IsleMind enables chat, streaming, tools, image_url, model-list, endpoint-backed audio transcription/speech, embeddings, and GPT-OSS reasoning_effort mapping; generic file attachments, chat audio_url input, response_format request controls, and native rerank app routing stay unclaimed until app routing exists.',
  }),
  fireworks: evidence({
    id: 'fireworks',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.fireworks.ai/api-reference/post-chatcompletions',
      'https://docs.fireworks.ai/tools-sdks/openai-compatibility',
      'https://docs.fireworks.ai/api-reference/list-models',
      'https://docs.fireworks.ai/api-reference/post-responses',
      'https://docs.fireworks.ai/guides/querying-text-models',
      'https://docs.fireworks.ai/guides/function-calling',
      'https://docs.fireworks.ai/guides/querying-vision-language-models',
      'https://docs.fireworks.ai/guides/reasoning',
      'https://docs.fireworks.ai/structured-responses/structured-response-formatting',
      'https://docs.fireworks.ai/api-reference/creates-an-embedding-vector-representing-the-input-text',
      'https://docs.fireworks.ai/api-reference/rerank-documents',
      'https://docs.fireworks.ai/serverless/rate-limits',
      'https://docs.fireworks.ai/guides/inference-error-codes',
      'https://docs.fireworks.ai/guides/video-audio-inputs',
    ],
    endpointFamilies: ['/inference/v1/chat/completions', '/inference/v1/responses', '/inference/v1/models', '/inference/v1/embeddings', '/inference/v1/rerank'],
    behaviorDocs: [...COMMON_OPENAI_COMPATIBLE_BEHAVIORS.filter((behavior) => !['files', 'audio', 'structuredOutput'].includes(behavior)), 'responsesApi', 'embeddings'],
    auditState: 'conformance-ready',
    notes: 'Fireworks OpenAI-compatible inference route with official Chat Completions, Responses, models, tools, JSON/schema output, image_url vision, reasoning_effort, embeddings, rerank, errors, and rate-limit docs mapped. IsleMind enables chat, streaming, tools, image_url, model-list, Responses only when model metadata selects it, embeddings, and Fireworks model-family reasoning_effort mapping; generic file attachments, chat audio/video inputs, response_format request controls, native rerank app routing, and Files API asset routing stay unclaimed until app attachment routing exists.',
  }),
  perplexity: evidence({
    id: 'perplexity',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.perplexity.ai/api-reference/sonar-post.md',
      'https://docs.perplexity.ai/docs/sonar/features.md',
      'https://docs.perplexity.ai/docs/sonar/models.md',
      'https://docs.perplexity.ai/docs/sonar/media.md',
      'https://docs.perplexity.ai/docs/sonar/filters.md',
      'https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers.md',
      'https://docs.perplexity.ai/docs/sdk/error-handling.md',
    ],
    endpointFamilies: ['/v1/sonar', '/v1/async/sonar'],
    behaviorDocs: ['auth', 'chat', 'streaming', 'structuredOutput', 'nativeSearch', 'vision', 'files', 'reasoning', 'errors', 'rateLimits', 'citations'],
    auditState: 'conformance-ready',
    notes: 'Sonar uses the official /v1/sonar endpoint with provider-native search, top-level citations/search_results, JSON Schema response_format, image_url/file_url media parts, and reasoning_effort for reasoning Sonar models. Generic /models sync and OpenAI Responses tools are intentionally unclaimed.',
  }),
  cohere: evidence({
    id: 'cohere',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.cohere.com/v2/docs/compatibility-api.md',
      'https://docs.cohere.com/v2/docs/models.md',
      'https://docs.cohere.com/v2/reference/chat.md',
      'https://docs.cohere.com/v2/reference/embed.md',
      'https://docs.cohere.com/v2/reference/rerank.md',
      'https://docs.cohere.com/v2/reference/list-models.md',
    ],
    endpointFamilies: ['/compatibility/v1/chat/completions', '/compatibility/v1/embeddings', '/compatibility/v1/audio/transcriptions', '/v2/chat', '/v2/embed', '/v2/rerank', '/v1/models'],
    behaviorDocs: ['auth', 'chat', 'streaming', 'tools', 'structuredOutput', 'reasoning', 'audio', 'embeddings', 'errors', 'rateLimits', 'deprecation'],
    auditState: 'conformance-ready',
    notes: 'Compatibility API supports OpenAI-format chat, streaming, tools, structured outputs, embeddings, audio transcriptions, and reasoning_effort limited to none/high. IsleMind keeps generic model-list sync, compatibility vision/files, and native Cohere documents/citations unclaimed until provider-specific routing exists; native /v1/models, /v2/chat, /v2/embed, and /v2/rerank are mapped as official surfaces but are not flattened into the compatibility preset.',
  }),
  cerebras: evidence({
    id: 'cerebras',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://inference-docs.cerebras.ai/api-reference/authentication.md',
      'https://inference-docs.cerebras.ai/resources/openai.md',
      'https://inference-docs.cerebras.ai/api-reference/chat-completions.md',
      'https://inference-docs.cerebras.ai/capabilities/streaming.md',
      'https://inference-docs.cerebras.ai/capabilities/tool-use.md',
      'https://inference-docs.cerebras.ai/capabilities/structured-outputs.md',
      'https://inference-docs.cerebras.ai/capabilities/reasoning.md',
      'https://inference-docs.cerebras.ai/api-reference/models/list-models.md',
      'https://inference-docs.cerebras.ai/models/openai-oss.md',
      'https://inference-docs.cerebras.ai/models/zai-glm-47.md',
      'https://inference-docs.cerebras.ai/support/error.md',
      'https://inference-docs.cerebras.ai/support/rate-limits.md',
      'https://inference-docs.cerebras.ai/support/deprecation.md',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'structuredOutput', 'reasoning', 'modelList', 'deprecation'],
    auditState: 'conformance-ready',
    notes: 'Mostly OpenAI-compatible text chat route with streaming, function tools, strict JSON schema, JSON object mode, /v1/models, model-specific reasoning_effort, and Cerebras-specific reasoning replay mapped. Generic vision, file attachments, audio, embeddings, rerank, and OpenAI Responses routing stay unclaimed because the public shared endpoint docs do not expose those app-compatible surfaces.',
  }),
  sambanova: evidence({
    id: 'sambanova',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://sambanova-systems.mintlify.dev/docs/en/features/openai-compatibility.md',
      'https://sambanova-systems.mintlify.dev/docs/api-reference/chat-completions/create-chat-based-completion.md',
      'https://sambanova-systems.mintlify.dev/docs/en/features/function-calling.md',
      'https://sambanova-systems.mintlify.dev/docs/en/features/responses.md',
      'https://sambanova-systems.mintlify.dev/docs/en/features/vision.md',
      'https://sambanova-systems.mintlify.dev/docs/en/models/sambacloud-models.md',
      'https://sambanova-systems.mintlify.dev/docs/api-reference/models/get-environments-available-model-list-metadata.md',
      'https://sambanova-systems.mintlify.dev/docs/en/api-reference/using-the-api/api-error-codes.md',
      'https://sambanova-systems.mintlify.dev/docs/en/models/rate-limits.md',
      'https://sambanova-systems.mintlify.dev/docs/en/models/deprecations.md',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/responses', '/v1/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'responsesApi', 'tools', 'structuredOutput', 'vision', 'reasoning', 'modelList', 'deprecation'],
    auditState: 'conformance-ready',
    notes: 'Current Mintlify docs replace stale /cloud/docs paths. SambaCloud chat supports streaming, OpenAI-format tools, JSON object/schema output, base64 image_url vision, /models, and gpt-oss-120b reasoning_effort with reasoning replay; Responses is limited to model metadata selecting gpt-oss-120b. Audio, embeddings, generic files, rerank, speech, and native search stay unclaimed for the default SambaCloud preset because the documented audio/embedding surfaces are SambaStack-only or not routed by the app.',
  }),
  'nvidia-nim': evidence({
    id: 'nvidia-nim',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.api.nvidia.com/nim/reference/llm-apis',
      'https://docs.api.nvidia.com/nim/reference/models-1',
      'https://docs.api.nvidia.com/nim/reference/meta-llama-3_2-90b-vision-instruct-infer',
      'https://docs.api.nvidia.com/nim/reference/retrieval-apis',
      'https://build.nvidia.com/explore/discover',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models', 'model-specific /v1/gr/.../chat/completions'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'vision', 'modelList'],
    auditState: 'conformance-ready',
    notes: 'NIM documents OpenAI-compatible LLM chat under https://integrate.api.nvidia.com with Bearer auth, Chat Completions, and OpenAI-style model listing. Vision is documented through model-specific image_url examples; generic tools/function calling, response_format, reasoning_effort, files, audio, speech, embeddings, and rerank stay unclaimed until NVIDIA docs and app routing prove those surfaces for the default integrate API.',
  }),
  huggingface: evidence({
    id: 'huggingface',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://huggingface.co/docs/inference-providers/tasks/chat-completion.md',
      'https://huggingface.co/docs/inference-providers/guides/function-calling.md',
      'https://huggingface.co/docs/inference-providers/guides/structured-output.md',
      'https://huggingface.co/docs/inference-providers/guides/responses-api.md',
      'https://huggingface.co/docs/inference-providers/guides/gpt-oss.md',
      'https://huggingface.co/docs/api-inference/en/quicktour',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/responses', '/v1/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'responsesApi', 'tools', 'structuredOutput', 'vision', 'reasoning', 'modelList', 'relayRouting'],
    auditState: 'conformance-ready',
    notes: 'Inference Providers document OpenAI-compatible Chat Completions on https://router.huggingface.co/v1, model listing, tools, structured outputs, Responses API beta, image_url VLM chat, and model/provider-dependent reasoning_effort. Generic OpenAI file_data attachments, audio, speech, embeddings, rerank, and provider-independent reasoning remain unclaimed; reasoning is enabled only for source-backed model families such as openai/gpt-oss through focused fixtures or explicit model metadata.',
  }),
  'github-models': evidence({
    id: 'github-models',
    protocol: 'openai-compatible',
    officialDocs: ['https://docs.github.com/en/github-models', 'https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models'],
    endpointFamilies: ['/inference/chat/completions', '/inference/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'vision', 'modelList', 'hostedRouting'],
    auditState: 'conformance-ready',
    notes: 'GitHub Models documents OpenAI-compatible model prototyping behind https://models.github.ai/inference with GitHub token auth. IsleMind keeps Chat Completions, /models discovery, OpenAI-style responses, model-metadata vision, and OpenAI-format tools covered offline. Generic file_data attachments, audio, speech, reasoning_effort, embeddings, rerank, structured output request controls, and OpenAI Responses routing stay unclaimed until official docs and app routing prove those surfaces.',
  }),
  deepinfra: evidence({
    id: 'deepinfra',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.deepinfra.com/chat/overview.md',
      'https://docs.deepinfra.com/chat/streaming.md',
      'https://docs.deepinfra.com/chat/tool-calling.md',
      'https://docs.deepinfra.com/chat/structured-outputs.md',
      'https://docs.deepinfra.com/chat/vision.md',
      'https://docs.deepinfra.com/chat/reasoning.md',
      'https://docs.deepinfra.com/apis/embeddings.md',
      'https://docs.deepinfra.com/apis/reranker.md',
      'https://docs.deepinfra.com/apis/speech.md',
      'https://docs.deepinfra.com/apis/text-to-speech.md',
      'https://docs.deepinfra.com/account/rate-limits.md',
      'https://docs.deepinfra.com/api-reference/models/openai-models.md',
    ],
    endpointFamilies: ['/v1/openai/chat/completions', '/v1/openai/models', '/v1/openai/embeddings', '/v1/inference/{model_name}'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'structuredOutput', 'vision', 'reasoning', 'embeddings', 'modelList', 'deprecation'],
    auditState: 'conformance-ready',
    notes: 'DeepInfra documents OpenAI-compatible chat, streaming, tools, JSON/schema response_format, image_url vision, reasoning_effort none/low/medium/high, /v1/openai/models metadata tags, /v1/openai/embeddings, and 429 rate limits. Native /v1/inference rerank, speech recognition, and text-to-speech docs are mapped as source evidence but remain unclaimed by the default preset until IsleMind routes those native endpoints.',
  }),
  novita: evidence({
    id: 'novita',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://novita.ai/docs/llms.txt',
      'https://novita.ai/docs/guides/llm-api',
      'https://novita.ai/docs/api-reference/model-apis-llm-create-chat-completion',
      'https://novita.ai/docs/guides/llm-vision',
      'https://novita.ai/docs/guides/llm-function-calling',
      'https://novita.ai/docs/guides/llm-structured-outputs',
      'https://novita.ai/docs/guides/llm-reasoning',
      'https://novita.ai/docs/api-reference/model-apis-llm-list-models',
      'https://novita.ai/docs/api-reference/model-apis-llm-create-embeddings',
      'https://novita.ai/docs/api-reference/model-apis-llm-create-rerank',
      'https://novita.ai/docs/api-reference/basic-error-code',
    ],
    endpointFamilies: ['/openai/v1/chat/completions', '/openai/v1/models', '/openai/v1/embeddings', '/openai/v1/rerank'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'structuredOutput', 'vision', 'reasoning', 'embeddings', 'modelList', 'deprecation'],
    auditState: 'conformance-ready',
    notes: 'Novita documents the OpenAI-compatible SDK base as https://api.novita.ai/openai, with API routes under /openai/v1. IsleMind normalizes the official base to /openai/v1, keeps legacy /v3/openai user URLs detectable, enables chat, streaming, tools, JSON/schema docs, image_url vision, model sync, embeddings, and reasoning_content parsing, but does not claim generic file_data, chat audio, speech, OpenAI Responses, reasoning_effort controls, or native rerank app routing.',
  }),
  siliconflow: evidence({
    id: 'siliconflow',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.siliconflow.cn/llms.txt',
      'https://docs.siliconflow.cn/cn/userguide/introduction',
      'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions',
      'https://docs.siliconflow.cn/cn/api-reference/models/get-model-list',
      'https://docs.siliconflow.cn/cn/api-reference/embeddings/create-embeddings',
      'https://docs.siliconflow.cn/cn/api-reference/rerank/create-rerank',
      'https://docs.siliconflow.cn/cn/userguide/capabilities/multimodal-vision',
      'https://docs.siliconflow.cn/cn/userguide/capabilities/reasoning',
      'https://docs.siliconflow.cn/cn/userguide/guides/function-calling',
      'https://docs.siliconflow.cn/cn/userguide/guides/json-mode',
      'https://docs.siliconflow.cn/cn/faqs/stream-mode',
      'https://docs.siliconflow.cn/cn/faqs/error-code',
      'https://docs.siliconflow.cn/cn/userguide/rate-limits/rate-limit-and-upgradation',
      'https://docs.siliconflow.cn/cn/api-reference/audio/create-speech',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models', '/v1/embeddings', '/v1/rerank', '/v1/audio/speech'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'structuredOutput', 'vision', 'reasoning', 'embeddings', 'modelList', 'deprecation'],
    auditState: 'conformance-ready',
    notes: 'SiliconFlow documents OpenAI-compatible chat on https://api.siliconflow.cn/v1 with Bearer auth, SSE streaming, OpenAI-format function tools, JSON mode response_format, image_url multimodal chat, reasoning models that return reasoning_content and accept thinking_budget, authenticated /v1/models, /v1/embeddings, native /v1/rerank, TTS, error codes, and rate limits. IsleMind enables chat, streaming, tools, image_url vision, authenticated model sync, embeddings, and SiliconFlow thinking_budget mapping for source-backed reasoning models; generic file_data, chat audio/video, native rerank, TTS/speech, OpenAI Responses, and multimodal embedding/rerank routing stay unclaimed until app routing exists.',
  }),
  modelscope: evidence({
    id: 'modelscope',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://modelscope.cn/docs/model-service/API-Inference/intro',
      'https://www.modelscope.cn/docs/model-service/API-Inference/API%20Reference/chat-completion',
      'https://api-inference.modelscope.cn/v1/models',
      'https://api-inference.modelscope.cn/v1/chat/completions',
      'https://api-inference.modelscope.cn/v1/embeddings',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models', '/v1/embeddings'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'embeddings', 'modelList'],
    auditState: 'conformance-ready',
    notes: 'ModelScope API-Inference exposes an OpenAI-compatible base at https://api-inference.modelscope.cn/v1. IsleMind keeps chat, streaming, public /v1/models sync, Bearer-token auth diagnostics, OpenAI-compatible response parsing, and generic /v1/embeddings routing covered. Qwen/DeepSeek model names do not inherit DashScope thinking or stream-usage fields. Vision, file_data attachments, chat audio, transcription, speech, OpenAI Responses, reasoning_effort, and OpenAI-format tool declarations stay unclaimed until source-backed ModelScope request fixtures prove those surfaces.',
  }),
  'volcengine-ark': evidence({
    id: 'volcengine-ark',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://www.volcengine.com/docs/82379/1494384',
      'https://www.volcengine.com/docs/82379/1330310',
      'https://www.volcengine.com/docs/82379/1262342',
      'https://www.volcengine.com/docs/82379/1362931',
      'https://www.volcengine.com/docs/82379/1848593',
      'https://www.volcengine.com/docs/82379/1350667',
    ],
    endpointFamilies: ['/api/v3/chat/completions', '/api/v3/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'vision', 'modelList', 'deprecation'],
    auditState: 'conformance-ready',
    notes: 'Current Volcengine Ark docs replace stale /1298454 and /1263482 paths with Chat API, model list, Function Calling, image understanding, rate-limit, and model-deprecation pages. IsleMind keeps /api/v3 chat, streaming, /api/v3/models sync, Bearer auth, OpenAI-format tools, image_url vision, max_tokens, OpenAI-compatible parsing, and rate-limit diagnostics covered offline. Generic file_data attachments, response_format request controls, chat audio/transcription/speech, embeddings, rerank, OpenAI Responses, and reasoning controls stay unclaimed until source-backed runtime fixtures exist.',
  }),
  'baidu-qianfan': evidence({
    id: 'baidu-qianfan',
    protocol: 'openai-compatible',
    officialDocs: ['https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Fm2vrveyu', 'https://cloud.baidu.com/doc/WENXINWORKSHOP/s/4m2u2ai7e'],
    endpointFamilies: ['/v2/chat/completions', '/v2/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'vision', 'modelList'],
    auditState: 'conformance-ready',
    notes: 'Baidu Qianfan v2 OpenAI-compatible route with official chat and model-list docs mapped. IsleMind keeps Bearer auth, chat, streaming, /v2/models sync, OpenAI-format tools, image_url vision, max_tokens, OpenAI-compatible parsing, and rate-limit diagnostics covered offline. Generic file_data attachments, response_format request controls, audio/speech, embeddings, rerank, OpenAI Responses, and reasoning controls stay unclaimed until source-backed runtime fixtures exist.',
  }),
  'tencent-hunyuan': evidence({
    id: 'tencent-hunyuan',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://cloud.tencent.com/document/product/1729/111007',
      'https://cloud.tencent.com/document/product/1729/111008',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'vision', 'modelList'],
    auditState: 'conformance-ready',
    notes: 'Tencent Hunyuan OpenAI-compatible route with official Chat Completions and model-list docs mapped. IsleMind keeps Bearer auth, chat, streaming, /v1/models sync, OpenAI-format tools, image_url vision, max_tokens, OpenAI-compatible parsing, and rate-limit diagnostics covered offline. Generic file_data attachments, response_format request controls, audio/speech, embeddings, rerank, OpenAI Responses, and reasoning controls stay unclaimed until source-backed runtime fixtures exist.',
  }),
  baichuan: evidence({
    id: 'baichuan',
    protocol: 'openai-compatible',
    officialDocs: ['https://platform.baichuan-ai.com/docs/api'],
    endpointFamilies: ['/v1/chat/completions'],
    behaviorDocs: CORE_PROVIDER_COMPATIBILITY_BEHAVIORS,
    auditState: 'conformance-ready',
    notes: 'Baichuan documents POST https://api.baichuan-ai.com/v1/chat/completions with JSON body, Bearer auth, the stream switch, and an error-code page. IsleMind keeps chat, streaming, max_tokens, OpenAI-compatible parsing, static/manual catalog behavior, and error diagnostics covered offline. Generic /models sync, OpenAI-format tools, image_url vision, file_data attachments, response_format request controls, audio/speech, embeddings, rerank, OpenAI Responses, and reasoning controls stay unclaimed until source-backed runtime fixtures exist.',
  }),
  stepfun: evidence({
    id: 'stepfun',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create',
      'https://platform.stepfun.com/docs/zh/api-reference/models/list',
      'https://platform.stepfun.com/docs/zh/api-reference/tool-call',
      'https://platform.stepfun.com/docs/zh/guides/developer/image-chat',
      'https://platform.stepfun.com/docs/zh/api-reference/error-codes',
      'https://platform.stepfun.com/docs/llms.txt',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'vision', 'modelList'],
    auditState: 'conformance-ready',
    notes: 'StepFun current Mintlify docs replace the stale /docs/llm paths. Chat Completions documents POST https://api.stepfun.com/v1/chat/completions, Bearer auth, stream, max_tokens, OpenAI-format tools/tool_calls, image_url multimodal parts, response_format, reasoning_effort, and 429/error behavior; model-list docs expose /v1/models. IsleMind keeps chat, streaming, /v1/models sync, OpenAI-format tools, image_url vision, max_tokens, OpenAI-compatible parsing, and diagnostics covered offline. Generic file_data attachments, response_format request controls, audio/speech, embeddings, rerank, OpenAI Responses, and reasoning controls stay unclaimed until source-backed runtime fixtures exist.',
  }),
  'zero-one': evidence({
    id: 'zero-one',
    protocol: 'openai-compatible',
    officialDocs: ['https://platform.lingyiwanwu.com/docs/api-reference'],
    endpointFamilies: ['/v1/chat/completions', '/v1/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'tools', 'vision', 'modelList'],
    auditState: 'conformance-ready',
    notes: '01.AI / Lingyi Wanwu documents https://api.lingyiwanwu.com/v1/chat/completions, Bearer auth, the stream switch, OpenAI-format function tools/tool calls, image_url multimodal message parts, https://api.lingyiwanwu.com/v1/models, and 429/error diagnostics. IsleMind keeps chat, streaming, /v1/models sync, OpenAI-format tools, image_url vision, max_tokens, OpenAI-compatible parsing, and error diagnostics covered offline. Generic file_data attachments, response_format request controls, audio/speech, embeddings, rerank, OpenAI Responses, and reasoning controls stay unclaimed until source-backed runtime fixtures exist.',
  }),
  'azure-openai': evidence({
    id: 'azure-openai',
    protocol: 'hosted-openai-compatible',
    officialDocs: ['https://learn.microsoft.com/azure/ai-foundry/openai/reference', 'https://learn.microsoft.com/azure/ai-services/openai/how-to/responses'],
    endpointFamilies: ['/openai/v1/chat/completions', '/openai/v1/responses', '/openai/v1/models'],
    behaviorDocs: [...COMMON_OPENAI_COMPATIBLE_BEHAVIORS, 'responsesApi', 'hostedRouting'],
    liveSmoke: [
      liveSmokeGate({
        id: 'azure-openai-v1-chat',
        kind: 'hosted-account',
        requiredEnv: ['ISLEMIND_AZURE_OPENAI_BASE_URL', 'ISLEMIND_AZURE_OPENAI_API_KEY', 'ISLEMIND_AZURE_OPENAI_MODEL'],
        validates: LIVE_SMOKE_HOSTED_CHAT_BEHAVIORS,
        skippedWithout: 'Requires an Azure OpenAI resource endpoint, API key, and deployed model name.',
      }),
    ],
    auditState: 'conformance-ready',
    notes: 'Azure OpenAI v1 resource endpoints are conformance-ready for /openai/v1 Chat Completions, Responses, model listing, api-key auth, OpenAI-format tools, Chat response_format structured output, Responses file/image input, and model-metadata-gated Responses reasoning. Legacy deployment-style paths with api-version remain explicit hosted gaps instead of being normalized into the v1 resource route.',
  }),
  'aws-bedrock': evidence({
    id: 'aws-bedrock',
    protocol: 'hosted-openai-compatible',
    officialDocs: [
      'https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html',
      'https://docs.aws.amazon.com/bedrock/latest/userguide/inference-api.html',
      'https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models', '/model/{modelId}/invoke'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'modelList', 'hostedRouting'],
    liveSmoke: [
      liveSmokeGate({
        id: 'aws-bedrock-mantle-chat',
        kind: 'hosted-account',
        requiredEnv: ['ISLEMIND_AWS_BEDROCK_MANTLE_BASE_URL', 'ISLEMIND_AWS_BEDROCK_MANTLE_API_KEY', 'ISLEMIND_AWS_BEDROCK_MANTLE_MODEL'],
        validates: LIVE_SMOKE_HOSTED_CHAT_BEHAVIORS,
        skippedWithout: 'Requires a Bedrock Mantle base URL, Bedrock API key, and model id with account access.',
      }),
      liveSmokeGate({
        id: 'aws-bedrock-runtime-invoke',
        kind: 'hosted-account',
        requiredEnv: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'ISLEMIND_AWS_BEDROCK_RUNTIME_MODEL'],
        validates: ['auth', 'chat', 'errors', 'rateLimits', 'hostedRouting'],
        skippedWithout: 'Requires AWS SigV4 credentials, region, and a Bedrock Runtime model id with enabled access.',
      }),
    ],
    auditState: 'needs-live-smoke',
    notes: 'Bedrock Mantle current docs prove OpenAI-compatible Chat Completions, streaming, /v1/models, and Bearer API-key auth. IsleMind keeps that hosted path partial-ready while direct Runtime InvokeModel signing is implemented for non-streaming Anthropic-style chat only. Bedrock Responses, structured output, OpenAI-format tools, multimodal/files, reasoning request controls, Runtime model-list, Runtime streaming, Converse/ConverseStream, and account/model access remain unclaimed until current AWS docs or live smoke prove them.',
  }),
  'vertex-ai': evidence({
    id: 'vertex-ai',
    protocol: 'hosted-openai-compatible',
    officialDocs: ['https://cloud.google.com/vertex-ai/generative-ai/docs/start/openai', 'https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference'],
    endpointFamilies: ['/v1/projects/{project}/locations/{location}/endpoints/openapi/chat/completions', '/v1beta/models/{model}:generateContent'],
    behaviorDocs: [...COMMON_OPENAI_COMPATIBLE_BEHAVIORS.filter((behavior) => !['files', 'modelList'].includes(behavior)), 'hostedRouting'],
    liveSmoke: [
      liveSmokeGate({
        id: 'vertex-ai-openapi-chat',
        kind: 'hosted-account',
        requiredEnv: ['ISLEMIND_VERTEX_AI_PROJECT', 'ISLEMIND_VERTEX_AI_LOCATION', 'ISLEMIND_VERTEX_AI_ACCESS_TOKEN', 'ISLEMIND_VERTEX_AI_MODEL'],
        validates: LIVE_SMOKE_HOSTED_CHAT_BEHAVIORS,
        skippedWithout: 'Requires a Google Cloud project, region, access token, and model available through Vertex AI OpenAPI routing.',
      }),
    ],
    auditState: 'needs-live-smoke',
    notes: 'Vertex AI OpenAI-compatible endpoints are partial-ready for Chat Completions, streaming, Bearer access-token auth, OpenAI-format tools, response_format structured output, image_url vision, and reasoning_effort. Generic OpenAI file_data attachments, automatic /models sync, Responses routing, and native Vertex Gemini generateContent routing remain planned or manual until current Google Cloud docs and app fixtures prove them.',
  }),
  ollama: evidence({
    id: 'ollama',
    protocol: 'local-openai-compatible',
    officialDocs: [
      'https://docs.ollama.com/api/openai-compatibility.md',
      'https://docs.ollama.com/api/chat.md',
      'https://docs.ollama.com/capabilities/structured-outputs.md',
      'https://docs.ollama.com/capabilities/thinking.md',
      'https://docs.ollama.com/capabilities/vision.md',
      'https://docs.ollama.com/api/embed.md',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/responses', '/v1/models', '/v1/embeddings', '/api/chat', '/api/embed'],
    behaviorDocs: [...COMMON_LOCAL_OPENAI_BEHAVIORS, 'responsesApi', 'reasoning', 'embeddings'],
    liveSmoke: [
      liveSmokeGate({
        id: 'ollama-local-chat',
        kind: 'local-runtime',
        requiredEnv: ['ISLEMIND_OLLAMA_BASE_URL', 'ISLEMIND_OLLAMA_MODEL'],
        validates: LIVE_SMOKE_LOCAL_CHAT_BEHAVIORS,
        skippedWithout: 'Requires a reachable Ollama server and an installed model id.',
      }),
    ],
    auditState: 'protocol-reference',
    notes: 'Ollama documents OpenAI-compatible chat, streaming with stream_options.include_usage, Chat response_format, tools, vision, reasoning_effort, non-stateful Responses, models, native thinking output, and embeddings. IsleMind keeps Responses routing explicit and does not claim Responses response_format controls until Ollama lists that field. Actual compatibility still depends on the Ollama version, locally installed model capabilities, and host reachability.',
  }),
  'lm-studio': evidence({
    id: 'lm-studio',
    protocol: 'local-openai-compatible',
    officialDocs: [
      'https://lmstudio.ai/docs/developer/openai-compat.md',
      'https://lmstudio.ai/docs/developer/openai-compat/chat-completions.md',
      'https://lmstudio.ai/docs/developer/openai-compat/responses.md',
      'https://lmstudio.ai/docs/developer/openai-compat/embeddings.md',
      'https://lmstudio.ai/docs/developer/openai-compat/tools.md',
      'https://lmstudio.ai/docs/developer/openai-compat/structured-output.md',
      'https://lmstudio.ai/docs/developer/core/authentication.md',
      'https://lmstudio.ai/docs/developer/api-changelog',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/responses', '/v1/models', '/v1/embeddings', '/v1/completions'],
    behaviorDocs: [...COMMON_LOCAL_OPENAI_BEHAVIORS, 'responsesApi', 'reasoning', 'embeddings'],
    liveSmoke: [
      liveSmokeGate({
        id: 'lm-studio-local-chat',
        kind: 'local-runtime',
        requiredEnv: ['ISLEMIND_LM_STUDIO_BASE_URL', 'ISLEMIND_LM_STUDIO_MODEL'],
        validates: LIVE_SMOKE_LOCAL_CHAT_BEHAVIORS,
        skippedWithout: 'Requires a reachable LM Studio local server and a loaded model id.',
      }),
    ],
    auditState: 'protocol-reference',
    notes: 'LM Studio documents OpenAI-compatible Chat Completions, streaming usage through stream_options.include_usage, Responses, model listing, embeddings, tool use, and Chat Completions structured output. Responses reasoning is documented through reasoning.effort, while Responses structured-output request controls stay unclaimed until LM Studio documents response_format or text.format there. Actual compatibility still depends on the loaded model, prompt template, runtime version, and local server settings.',
  }),
  localai: evidence({
    id: 'localai',
    protocol: 'local-openai-compatible',
    officialDocs: [
      'https://localai.io/basics/getting_started/',
      'https://localai.io/features/text-generation/',
      'https://localai.io/features/openai-functions/',
      'https://localai.io/features/constrained_grammars/',
      'https://localai.io/features/embeddings/',
      'https://localai.io/features/audio-to-text/',
      'https://localai.io/features/text-to-audio/',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models', '/v1/embeddings', '/v1/audio/transcriptions', '/v1/audio/speech'],
    behaviorDocs: [...COMMON_LOCAL_OPENAI_BEHAVIORS, 'audio', 'embeddings'],
    liveSmoke: [
      liveSmokeGate({
        id: 'localai-local-chat-audio',
        kind: 'local-runtime',
        requiredEnv: ['ISLEMIND_LOCALAI_BASE_URL', 'ISLEMIND_LOCALAI_MODEL'],
        validates: [...LIVE_SMOKE_LOCAL_CHAT_BEHAVIORS, 'audio'],
        skippedWithout: 'Requires a reachable LocalAI server and a configured backend model; audio checks also require matching LocalAI audio backends.',
      }),
    ],
    auditState: 'protocol-reference',
    notes: 'LocalAI is documented as an OpenAI-compatible local REST API. Current docs map Chat Completions, /v1/models, OpenAI functions/tools, grammar-constrained outputs, embeddings, audio transcription, and OpenAI-compatible speech/TTS. LocalAI structured output is documented through grammar / grammar_json_functions rather than IsleMind\'s current response_format planner, so app-side structured-output request controls stay blocked until a LocalAI grammar planner exists. Installed model, backend, build tags, and server configuration still determine the actual capabilities, so IsleMind keeps LocalAI as protocol-reference and treats multimodal/tool/audio/embedding behavior as declared, discovered, or manually configured local state.',
  }),
  vllm: evidence({
    id: 'vllm',
    protocol: 'local-openai-compatible',
    officialDocs: [
      'https://docs.vllm.ai/en/latest/serving/online_serving/',
      'https://docs.vllm.ai/en/latest/features/tool_calling.html',
      'https://docs.vllm.ai/en/latest/features/structured_outputs.html',
      'https://docs.vllm.ai/en/latest/features/reasoning_outputs.html',
      'https://docs.vllm.ai/en/latest/models/pooling_models.html',
    ],
    endpointFamilies: [
      '/v1/completions',
      '/v1/chat/completions',
      '/v1/chat/completions/batch',
      '/v1/responses',
      '/v1/models',
      '/v1/embeddings',
      '/v1/audio/transcriptions',
      '/v1/audio/translations',
      '/v1/score',
      '/v1/rerank',
      '/pooling',
    ],
    behaviorDocs: [...COMMON_LOCAL_OPENAI_BEHAVIORS, 'responsesApi', 'reasoning', 'embeddings'],
    liveSmoke: [
      liveSmokeGate({
        id: 'vllm-local-chat',
        kind: 'local-runtime',
        requiredEnv: ['ISLEMIND_VLLM_BASE_URL', 'ISLEMIND_VLLM_MODEL'],
        validates: LIVE_SMOKE_LOCAL_CHAT_BEHAVIORS,
        skippedWithout: 'Requires a reachable vLLM OpenAI-compatible server and served model id.',
      }),
    ],
    auditState: 'protocol-reference',
    notes: 'vLLM documents OpenAI-compatible online serving for Chat Completions, explicit Responses, model listing, embeddings, tool calling, structured outputs, reasoning outputs, ASR, score/rerank, and pooling. IsleMind enables chat, streaming, model sync, OpenAI-format tools, model-metadata vision, Chat Completions response_format, embeddings, model-metadata Chat reasoning_effort, and model-metadata Responses reasoning.effort. Responses routing stays explicit, while Responses structured output, ASR, score/rerank, and pooling remain unclaimed until app routing and local runtime fixtures cover them.',
  }),
  sglang: evidence({
    id: 'sglang',
    protocol: 'local-openai-compatible',
    officialDocs: [
      'https://docs.sglang.io/docs/basic_usage/openai_api.md',
      'https://docs.sglang.io/docs/basic_usage/openai_api_completions.md',
      'https://docs.sglang.io/docs/basic_usage/openai_api_embeddings.md',
      'https://docs.sglang.io/docs/basic_usage/openai_api_vision.md',
      'https://docs.sglang.io/docs/advanced_features/tool_parser.md',
      'https://docs.sglang.io/docs/advanced_features/structured_outputs.md',
      'https://docs.sglang.io/docs/advanced_features/separate_reasoning.md',
      'https://docs.sglang.io/docs/advanced_features/server_arguments.md',
    ],
    endpointFamilies: ['/v1/completions', '/v1/chat/completions', '/v1/models', '/v1/embeddings'],
    behaviorDocs: [...COMMON_LOCAL_OPENAI_BEHAVIORS, 'reasoning', 'embeddings'],
    liveSmoke: [
      liveSmokeGate({
        id: 'sglang-local-chat',
        kind: 'local-runtime',
        requiredEnv: ['ISLEMIND_SGLANG_BASE_URL', 'ISLEMIND_SGLANG_MODEL'],
        validates: LIVE_SMOKE_LOCAL_CHAT_BEHAVIORS,
        skippedWithout: 'Requires a reachable SGLang OpenAI-compatible server and served model id.',
      }),
    ],
    auditState: 'protocol-reference',
    notes: 'SGLang current docs live under docs.sglang.io, replacing the stale backend/*.html links. IsleMind maps OpenAI-compatible completions, chat completions, model listing, embeddings, image_url vision, tool parser/tool_calls, JSON/schema response_format structured outputs, and separate reasoning-output parsing docs. Chat, streaming, model sync, tools, model-metadata vision, Chat response_format, embeddings, non-streaming message.reasoning_content, and streaming delta.reasoning_content are covered offline; request-side separate_reasoning controls, Responses, audio, rerank, and diffusion/image generation endpoints remain unclaimed until app routing and source-backed fixtures exist.',
  }),
  openrouter: evidence({
    id: 'openrouter',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request',
      'https://openrouter.ai/docs/api/api-reference/responses/create-responses',
      'https://openrouter.ai/docs/api/api-reference/models/get-models',
      'https://openrouter.ai/docs/api/reference/responses/tool-calling',
      'https://openrouter.ai/docs/features/structured-outputs',
      'https://openrouter.ai/docs/features/multimodal/pdfs',
      'https://openrouter.ai/docs/features/provider-routing',
    ],
    endpointFamilies: ['/api/v1/chat/completions', '/api/v1/responses', '/api/v1/models'],
    behaviorDocs: [...COMMON_OPENAI_COMPATIBLE_BEHAVIORS, 'responsesApi', 'citations', 'relayRouting'],
    auditState: 'conformance-ready',
    notes: 'Aggregator route preserves upstream model capability differences. Offline fixtures cover chat routing, explicit Responses opt-in, response_format structured outputs gated by model supported_parameters, PDF file_data input on Chat Completions, tool declarations, model sync metadata, JSON/SSE parsing, retrieval citations, and rate-limit diagnostics.',
  }),
  newapi: evidence({
    id: 'newapi',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://docs.newapi.pro/zh/docs/api',
      'https://docs.newapi.pro/zh/docs/api/ai-model/chat/openai/createchatcompletion',
      'https://docs.newapi.pro/zh/docs/api/ai-model/chat/openai/createresponse',
      'https://docs.newapi.pro/zh/docs/api/ai-model/models/list/listmodels',
      'https://docs.newapi.pro/zh/docs/api/ai-model/unimplemented/files/listfiles',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/responses', '/v1/models'],
    behaviorDocs: [
      ...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS,
      'responsesApi',
      'tools',
      'structuredOutput',
      'reasoning',
      'modelList',
      'hostedRouting',
      'relayRouting',
    ],
    auditState: 'conformance-ready',
    notes: 'Current Chinese docs replace stale /en/api OpenAI Chat and Model paths. NewAPI documents OpenAI-compatible /v1/chat/completions, /v1/responses, /v1/models, Bearer auth, stream, tools/tool_calls, Chat response_format, reasoning_effort, Responses reasoning, and 400/429 errors; its Files page is explicitly unimplemented with 501. IsleMind keeps chat, explicit Responses opt-in, model sync, tools, Chat response_format structured output, model-metadata-gated reasoning_effort/reasoning, OpenAI-compatible parsing, and rate-limit diagnostics covered offline. Responses structured-output controls, generic file_data attachments, and provider-wide relay vision stay unclaimed by default; image input can still come from remote model metadata, the known model catalog, or manual capability declaration. Chat audio, transcription, speech, embeddings, and rerank stay unclaimed until source-backed app routing exists.',
  }),
  sub2api: evidence({
    id: 'sub2api',
    protocol: 'openai-compatible',
    officialDocs: [
      'https://sub2api.info/',
      'https://github.com/Wei-Shaw/sub2api',
      'https://raw.githubusercontent.com/Wei-Shaw/sub2api/main/README.md',
    ],
    endpointFamilies: ['/v1/chat/completions', '/v1/models', '/v1/responses'],
    behaviorDocs: [
      ...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS,
      'tools',
      'modelList',
      'hostedRouting',
      'relayRouting',
    ],
    auditState: 'docs-mapped',
    liveSmoke: [
      liveSmokeGate({
        id: 'sub2api-relay-chat',
        kind: 'relay-account',
        requiredEnv: ['ISLEMIND_SUB2API_BASE_URL', 'ISLEMIND_SUB2API_API_KEY', 'ISLEMIND_SUB2API_MODEL'],
        validates: LIVE_SMOKE_RELAY_CHAT_BEHAVIORS,
        skippedWithout: 'Requires the active Sub2API gateway URL, API key, and a supplier-backed model id without flattening supplier capabilities into the client.',
      }),
    ],
    notes: 'Current Sub2API public site is a minimal AI API Gateway page; the active GitHub source appears to be Wei-Shaw/sub2api, whose README documents a relay platform for subscription quota distribution, API key distribution, load balancing, request forwarding, configurable rate limits, and Claude/OpenAI/Gemini/Antigravity subscription unification. Endpoint-level OpenAI-compatible Chat/Responses/Models docs remain weak and the README does not document response_format, reasoning_effort, or tool_call payload contracts, so IsleMind keeps Sub2API docs-mapped and requires explicit relay capability declarations or remote model metadata instead of flattening supplier capabilities into the preset.',
  }),
  'custom-openai-compatible': evidence({
    id: 'custom-openai-compatible',
    protocol: 'openai-compatible',
    officialDocs: ['https://platform.openai.com/docs/api-reference/chat', 'https://platform.openai.com/docs/api-reference/responses'],
    endpointFamilies: ['/chat/completions', '/responses', '/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'modelList'],
    liveSmoke: [
      liveSmokeGate({
        id: 'custom-openai-compatible-chat',
        kind: 'custom-endpoint',
        requiredEnv: ['ISLEMIND_CUSTOM_OPENAI_BASE_URL', 'ISLEMIND_CUSTOM_OPENAI_API_KEY', 'ISLEMIND_CUSTOM_OPENAI_MODEL'],
        validates: ['auth', 'chat', 'streaming', 'modelList', 'errors', 'rateLimits'],
        skippedWithout: 'Requires a user-declared compatible base URL, API key, and model id before optional capabilities can be probed.',
      }),
    ],
    auditState: 'protocol-reference',
    notes: 'Custom OpenAI-compatible endpoints are protocol references until declared, probed, or manually configured capabilities are present. The preset keeps optional tools, structured output, image/file attachments, reasoning controls, native search, audio, and Responses routing off by default; users or remote model metadata can explicitly enable supported behavior.',
  }),
  'custom-anthropic-compatible': evidence({
    id: 'custom-anthropic-compatible',
    protocol: 'anthropic-compatible',
    officialDocs: ['https://docs.anthropic.com/en/api/messages'],
    endpointFamilies: ['/v1/messages', '/v1/models'],
    behaviorDocs: [...CORE_PROVIDER_COMPATIBILITY_BEHAVIORS, 'modelList'],
    liveSmoke: [
      liveSmokeGate({
        id: 'custom-anthropic-compatible-messages',
        kind: 'custom-endpoint',
        requiredEnv: ['ISLEMIND_CUSTOM_ANTHROPIC_BASE_URL', 'ISLEMIND_CUSTOM_ANTHROPIC_API_KEY', 'ISLEMIND_CUSTOM_ANTHROPIC_MODEL'],
        validates: ['auth', 'chat', 'streaming', 'modelList', 'errors', 'rateLimits'],
        skippedWithout: 'Requires a user-declared Anthropic-compatible base URL, API key, and model id before optional capabilities can be probed.',
      }),
    ],
    auditState: 'protocol-reference',
    notes: 'Custom Anthropic-compatible endpoints are protocol references until declared, probed, or manually configured capabilities are present. The preset keeps optional image/file attachments and reasoning controls off by default; Anthropic message/tool request shapes can be used only when a compatible endpoint is selected or declared.',
  }),
} as const satisfies Record<ProviderPresetId, ProviderCompatibilityEvidence>

export function getProviderCompatibilityEvidence(id: ProviderPresetId): ProviderCompatibilityEvidence {
  return PROVIDER_COMPATIBILITY_EVIDENCE[id]
}

export function resolveProviderCompatibilityEvidenceId(provider: ProviderCompatibilityEvidenceProviderLike): ProviderPresetId {
  if (provider.presetId && PROVIDER_COMPATIBILITY_EVIDENCE[provider.presetId]) return provider.presetId
  if (provider.detectedPresetId && PROVIDER_COMPATIBILITY_EVIDENCE[provider.detectedPresetId]) return provider.detectedPresetId
  if (provider.type === 'openai') return 'openai'
  if (provider.type === 'anthropic') return provider.wireProtocol === 'anthropic-compatible' ? 'custom-anthropic-compatible' : 'anthropic'
  if (provider.type === 'google') return 'google'
  if (provider.type === 'xiaomi-mimo') return 'xiaomi-mimo'
  return provider.wireProtocol === 'anthropic-compatible' ? 'custom-anthropic-compatible' : 'custom-openai-compatible'
}

export function getProviderCompatibilityEvidenceForProvider(
  provider: ProviderCompatibilityEvidenceProviderLike | Pick<AIProvider, 'type' | 'presetId' | 'detectedPresetId' | 'wireProtocol'>
): ProviderCompatibilityEvidence {
  return getProviderCompatibilityEvidence(resolveProviderCompatibilityEvidenceId(provider))
}

export function findProviderCompatibilityEvidenceGaps(presetIds: readonly ProviderPresetId[]): ProviderPresetId[] {
  return presetIds.filter((id) => !PROVIDER_COMPATIBILITY_EVIDENCE[id])
}

export function findProviderCompatibilityBehaviorGaps(
  id: ProviderPresetId,
  required: readonly ProviderCompatibilityBehavior[] = CORE_PROVIDER_COMPATIBILITY_BEHAVIORS
): ProviderCompatibilityBehavior[] {
  const evidence = PROVIDER_COMPATIBILITY_EVIDENCE[id]
  return required.filter((behavior) => !evidence.behaviorDocs.includes(behavior))
}

export function providerCompatibilityEvidenceHasBehavior(
  id: ProviderPresetId,
  behavior: ProviderCompatibilityBehavior
): boolean {
  return PROVIDER_COMPATIBILITY_EVIDENCE[id].behaviorDocs.includes(behavior)
}

export function resolveProviderCompatibilityCapabilityStatus(
  id: ProviderPresetId,
  behavior: ProviderCompatibilityBehavior
): ProviderCompatibilityCapabilityStatus {
  const evidence = PROVIDER_COMPATIBILITY_EVIDENCE[id]
  const override = evidence.behaviorStatusOverrides?.[behavior]
  if (override) return override
  if (!evidence.behaviorDocs.includes(behavior)) return 'unsupported'
  if (evidence.auditState === 'conformance-ready') return 'supported'
  if (getProviderCompatibilityLiveSmokeGates(id).some((gate) => gate.validates.includes(behavior))) {
    return 'requiresLiveKey'
  }
  return 'partial'
}

export function buildProviderCompatibilityBehaviorStatusMap(
  id: ProviderPresetId
): ProviderCompatibilityBehaviorStatusMap {
  return Object.fromEntries(
    CANONICAL_PROVIDER_COMPATIBILITY_BEHAVIORS.map((behavior) => [
      behavior,
      resolveProviderCompatibilityCapabilityStatus(id, behavior),
    ])
  ) as ProviderCompatibilityBehaviorStatusMap
}

export function providerCompatibilityCapabilityCanBeSent(
  id: ProviderPresetId,
  behavior: ProviderCompatibilityBehavior
): boolean {
  const status = resolveProviderCompatibilityCapabilityStatus(id, behavior)
  return status === 'supported' || status === 'requiresLiveKey'
}

export function explainProviderCompatibilityCapabilityStatus(
  status: ProviderCompatibilityCapabilityStatus,
  auditState: ProviderCompatibilityAuditState
): ProviderCompatibilityCapabilityExplanation {
  if (status === 'supported') {
    return {
      limitationReason: 'contract_supported',
      degradationPath: 'send_allowed',
    }
  }
  if (status === 'requiresLiveKey') {
    return {
      limitationReason: 'live_smoke_required',
      degradationPath: 'run_live_smoke',
    }
  }
  if (status === 'docsChanged') {
    return {
      limitationReason: 'docs_changed',
      degradationPath: 'refresh_docs',
    }
  }
  if (auditState === 'protocol-reference') {
    return {
      limitationReason: status === 'partial' ? 'contract_partial' : 'contract_unclaimed',
      degradationPath: 'manual_declaration_or_model_metadata',
    }
  }
  if (status === 'partial') {
    return {
      limitationReason: 'contract_partial',
      degradationPath: 'local_fallback',
    }
  }
  return {
    limitationReason: 'contract_unclaimed',
    degradationPath: 'disable_parameter',
  }
}

export function providerCompatibilityCapabilityCanBeSentForProvider(
  provider: ProviderCompatibilityEvidenceProviderLike,
  behavior: ProviderCompatibilityBehavior,
  explicitDeclaration = false
): boolean {
  return resolveProviderCompatibilityCapabilitySendPolicy(provider, behavior, explicitDeclaration).allowed
}

export function resolveProviderCompatibilityCapabilitySendPolicy(
  provider: ProviderCompatibilityEvidenceProviderLike,
  behavior: ProviderCompatibilityBehavior,
  explicitDeclaration = false
): ProviderCompatibilityCapabilitySendPolicy {
  const evidence = getProviderCompatibilityEvidenceForProvider(provider)
  const status = resolveProviderCompatibilityCapabilityStatus(evidence.id, behavior)
  const explanation = explainProviderCompatibilityCapabilityStatus(status, evidence.auditState)

  if (status === 'supported' || status === 'requiresLiveKey') {
    if (behavior !== 'nativeSearch') {
      return {
        behavior,
        compatibilityId: evidence.id,
        auditState: evidence.auditState,
        status,
        allowed: true,
        sendSource: 'contract',
        ...explanation,
      }
    }
    if (providerCompatibilityEvidenceMatchesProvider(provider, evidence.id)) {
      return {
        behavior,
        compatibilityId: evidence.id,
        auditState: evidence.auditState,
        status,
        allowed: true,
        sendSource: 'provider_identity',
        ...explanation,
      }
    }
    if (explicitDeclaration) {
      return {
        behavior,
        compatibilityId: evidence.id,
        auditState: evidence.auditState,
        status,
        allowed: true,
        sendSource: 'explicit_declaration',
        ...explanation,
      }
    }
    return {
      behavior,
      compatibilityId: evidence.id,
      auditState: evidence.auditState,
      status,
      allowed: false,
      sendSource: 'blocked',
      limitationReason: 'contract_unclaimed',
      degradationPath: 'manual_declaration_or_model_metadata',
    }
  }

  if (explicitDeclaration && providerCompatibilityExplicitDeclarationCanOpenCapability(evidence, behavior)) {
    return {
      behavior,
      compatibilityId: evidence.id,
      auditState: evidence.auditState,
      status,
      allowed: true,
      sendSource: 'explicit_declaration',
      limitationReason: 'contract_unclaimed',
      degradationPath: 'manual_declaration_or_model_metadata',
    }
  }

  return {
    behavior,
    compatibilityId: evidence.id,
    auditState: evidence.auditState,
    status,
    allowed: false,
    sendSource: 'blocked',
    ...explanation,
  }
}

export function providerCompatibilityCapabilityExplicitlyDeclaredByProvider(
  provider: { capabilities?: Partial<NonNullable<AIProvider['capabilities']>> },
  behavior: ProviderCompatibilityBehavior
): boolean {
  const capabilities = provider.capabilities
  if (!capabilities) return false
  if (behavior === 'tools') return capabilities.nativeTools === true
  if (behavior === 'nativeSearch') return capabilities.nativeSearch === true
  if (behavior === 'vision') return capabilities.vision === true
  if (behavior === 'files') return capabilities.files === true
  if (behavior === 'audio') return capabilities.audioInput === true || capabilities.audioTranscription === true || capabilities.speech === true
  if (behavior === 'reasoning') return capabilities.reasoningEffort === true
  if (behavior === 'embeddings') return capabilities.embeddings === true
  if (behavior === 'rerank') return capabilities.rerank === true
  if (behavior === 'modelList') return capabilities.modelList === true
  if (behavior === 'responsesApi') return capabilities.responsesApi === true
  if (behavior === 'responsesWebSocket') return capabilities.responsesWebSocket === true
  if (behavior === 'remoteCompact') return capabilities.remoteCompact === true
  return false
}

export function providerCompatibilityReasoningExplicitlyDeclaredForModel(
  provider: Pick<AIProvider, 'capabilities'>,
  modelConfig: Pick<AIModel, 'source' | 'reasoningMode' | 'reasoningEfforts'>
): boolean {
  return provider.capabilities?.reasoningEffort === true ||
    (modelConfig.source === 'remote' && Boolean(modelConfig.reasoningMode || modelConfig.reasoningEfforts?.length))
}

function providerCompatibilityEvidenceMatchesProvider(
  provider: ProviderCompatibilityEvidenceProviderLike,
  id: ProviderPresetId
): boolean {
  return provider.presetId === id || provider.detectedPresetId === id || provider.id === id
}

function providerCompatibilityExplicitDeclarationCanOpenCapability(
  evidence: ProviderCompatibilityEvidence,
  behavior: ProviderCompatibilityBehavior,
): boolean {
  if (!DECLARABLE_PROTOCOL_REFERENCE_BEHAVIORS.includes(behavior)) return false
  if (evidence.auditState !== 'conformance-ready') return true
  return evidence.behaviorDocs.includes('relayRouting') &&
    CONFORMANCE_READY_RELAY_DECLARABLE_BEHAVIORS.includes(behavior)
}

export function getProviderCompatibilityLiveSmokeGates(id: ProviderPresetId): readonly ProviderCompatibilityLiveSmokeGate[] {
  return PROVIDER_COMPATIBILITY_EVIDENCE[id].liveSmoke ?? []
}

export function resolveProviderCompatibilityLiveSmokeStatus(
  id: ProviderPresetId,
  env: Record<string, string | undefined>
): ProviderCompatibilityLiveSmokeStatus[] {
  return getProviderCompatibilityLiveSmokeGates(id).map((gate) => {
    const missingEnv = gate.requiredEnv.filter((name) => !(env[name] ?? '').trim())
    return {
      gate,
      ready: missingEnv.length === 0,
      missingEnv,
    }
  })
}

export function findProviderCompatibilityLiveSmokeGaps(presetIds: readonly ProviderPresetId[]): ProviderPresetId[] {
  return presetIds.filter((id) => {
    const evidence = PROVIDER_COMPATIBILITY_EVIDENCE[id]
    return evidence.auditState !== 'conformance-ready' && getProviderCompatibilityLiveSmokeGates(id).length === 0
  })
}
