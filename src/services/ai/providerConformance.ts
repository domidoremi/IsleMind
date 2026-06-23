import { getModelConfig } from '@/types'
import type { AIProvider, Attachment, ProviderType, ReasoningEffort } from '@/types'
import { filterSendableAttachments } from '@/services/attachmentContract'
import { getReasoningEffortOptions, isCerebrasReasoningModel, isClaudeThinkingModel, isCohereReasoningModel, isDashScopeThinkingModel, isDeepInfraReasoningModel, isDeepSeekThinkingModel, isFireworksReasoningModel, isGeminiThinkingLevelModel, isGeminiThinkingModel, isGroqReasoningModel, isHuggingFaceReasoningModel, isKimiThinkingModel, isMiniMaxThinkingModel, isOpenAIReasoningModel, isPerplexityReasoningModel, isSambaNovaReasoningModel, isSiliconFlowReasoningModel, isTogetherReasoningModel, isXAIReasoningModel, isXAIMultiAgentReasoningModel, isXiaomiMimoReasoningModel, modelDisallowsAnthropicSampling, normalizeFireworksReasoningEffort } from '@/utils/modelReasoning'
import { supportsXiaomiMimoNativeWebSearch } from '@/services/ai/providerOpenAIRequest'
import { isBedrockRuntimeProvider } from '@/services/ai/providerAwsBedrockRouting'
import { getProviderCompatibilityEvidenceForProvider, providerCompatibilityCapabilityCanBeSent, providerCompatibilityCapabilityCanBeSentForProvider, providerCompatibilityReasoningExplicitlyDeclaredForModel } from '@/services/ai/providerCompatibilityContract'

export type ProviderConformanceFamily =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'dashscope'
  | 'moonshot'
  | 'xai'
  | 'bigmodel'
  | 'baidu-qianfan'
  | 'baichuan'
  | 'zero-one'
  | 'stepfun'
  | 'minimax'
  | 'mistral'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'perplexity'
  | 'cohere'
  | 'cerebras'
  | 'sambanova'
  | 'nvidia-nim'
  | 'huggingface'
  | 'github-models'
  | 'deepinfra'
  | 'novita'
  | 'siliconflow'
  | 'modelscope'
  | 'tencent-hunyuan'
  | 'volcengine-ark'
  | 'azure-openai'
  | 'aws-bedrock'
  | 'vertex-ai'
  | 'ollama'
  | 'lm-studio'
  | 'localai'
  | 'vllm'
  | 'sglang'
  | 'openrouter'
  | 'newapi'
  | 'sub2api'
  | 'xiaomi-mimo'
  | 'openai-compatible'
  | 'anthropic-compatible'

export type ProviderConformanceProtocol =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generate-content'
  | 'xiaomi-mimo-openai-compatible'
  | 'xiaomi-mimo-anthropic-compatible'
  | 'openai-compatible'
  | 'anthropic-compatible'

export type ProviderReasoningRequestShape =
  | 'none'
  | 'openai-reasoning-effort'
  | 'openai-responses-reasoning'
  | 'anthropic-output-config-effort'
  | 'anthropic-adaptive'
  | 'anthropic-budget'
  | 'deepseek-thinking'
  | 'dashscope-thinking'
  | 'kimi-thinking'
  | 'minimax-thinking'
  | 'xai-reasoning-effort'
  | 'groq-reasoning-effort'
  | 'together-reasoning-effort'
  | 'fireworks-reasoning-effort'
  | 'perplexity-reasoning-effort'
  | 'cohere-reasoning-effort'
  | 'cerebras-reasoning-effort'
  | 'sambanova-reasoning-effort'
  | 'huggingface-reasoning-effort'
  | 'deepinfra-reasoning-effort'
  | 'siliconflow-thinking-budget'
  | 'gemini-thinking-budget'
  | 'gemini-thinking-level'
  | 'xiaomi-mimo-thinking'

export type ProviderToolRequestShape =
  | 'none'
  | 'openai-tools'
  | 'anthropic-tools'
  | 'google-tools'

export type ProviderStructuredOutputRequestShape =
  | 'none'
  | 'openai-response-format'
  | 'openai-json-object-response-format'
  | 'openrouter-response-format'
  | 'xai-response-format'
  | 'anthropic-tool-schema'
  | 'google-response-schema'
  | 'localai-grammar'

export interface ProviderStructuredOutputRequest {
  type: 'json_object' | 'json_schema'
  name?: string
  schema?: Record<string, unknown>
  strict?: boolean
}

export type ProviderConformanceIssueCode =
  | 'unsupported_modality'
  | 'unsupported_tools'
  | 'unsupported_structured_output'
  | 'context_exceeded'
  | 'param_conflict_removed'
  | 'thinking_budget_adjusted'
  | 'reasoning_effort_downgraded'
  | 'provider_manifest_inferred'

export interface ProviderConformanceIssue {
  code: ProviderConformanceIssueCode
  severity: 'info' | 'warn' | 'block'
  message: string
  field?: string
  requested?: unknown
  effective?: unknown
}

export interface ProviderCapabilityManifest {
  id: string
  family: ProviderConformanceFamily
  protocol: ProviderConformanceProtocol
  providerType: ProviderType
  model: string
  transport: {
    streaming: boolean
    preferredEndpoint?: 'chat-completions' | 'responses'
  }
  context: {
    windowTokens: number
    maxOutputTokens: number
  }
  modalities: {
    input: {
      text: boolean
      image: boolean
      file: boolean
      audio: boolean
      video: boolean
    }
    output: {
      text: boolean
      speech: boolean
    }
  }
  reasoning: {
    supported: boolean
    requestShape: ProviderReasoningRequestShape
    selectableEfforts: ReasoningEffort[]
    disablesSamplingWhenEnabled: boolean
    minBudgetTokens?: number
  }
  payload: {
    maxTokensField: 'max_tokens' | 'max_output_tokens' | 'max_completion_tokens' | 'generationConfig.maxOutputTokens'
    samplingFields: string[]
    unsupportedFieldsWhenReasoning: string[]
    requiresReasoningStatePassthrough: boolean
    streamUsageField?: 'stream_options.include_usage'
    reasoningStatePreservationField?: 'thinking.keep' | 'reasoning' | 'reasoning_content' | 'anthropic-content-blocks'
    reasoningOutputSplitField?: 'reasoning_split'
    reasoningSummaryField?: 'reasoning.summary'
  }
  tools: {
    supported: boolean
    requestShape: ProviderToolRequestShape
    nativeWebSearchToolType?: 'web_search_preview' | 'web_search' | 'web_search_20250305' | 'web_search_20260209'
  }
  structuredOutput: {
    contractClaimed: boolean
    documentedRequestShape: ProviderStructuredOutputRequestShape
    appRequestControl: boolean
    jsonObjectMode: boolean
    strictJsonSchema: boolean
  }
  source: {
    url?: string
    verifiedAt?: string
    confidence: 'source-backed' | 'inferred'
  }
}

export interface ProviderConformanceRequest {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
  attachments?: Attachment[]
  webSearchMode?: string
  structuredOutput?: ProviderStructuredOutputRequest
}

export interface ProviderReasoningResolution {
  requested?: ReasoningEffort
  enabled: boolean
  effective?: ReasoningEffort
  providerValue?: string | number | boolean
  requestShape: ProviderReasoningRequestShape
  downgradeReason?: string
}

export interface ProviderConformanceResult {
  manifest: ProviderCapabilityManifest
  reasoning: ProviderReasoningResolution
  requestedModalities: string[]
  issues: ProviderConformanceIssue[]
  removedParams: string[]
  adjustedParams: Record<string, unknown>
  bodyKeys: string[]
}

export interface ProviderBodyConformanceResult {
  body: Record<string, unknown>
  conformance: ProviderConformanceResult
}

const OFF_EFFORTS = new Set<ReasoningEffort>(['none', 'minimal'])

export function resolveProviderCapabilityManifest(input: ProviderConformanceRequest): ProviderCapabilityManifest {
  const provider = input.provider
  const modelConfig = getModelConfig(input.model, provider.type, provider.modelConfigs)
  const family = inferProviderConformanceFamily(provider)
  const protocol = inferProtocol(input, family)
  const requestShape = inferReasoningRequestShape(input, family, protocol)
  const selectableEfforts = getReasoningEffortOptions(provider, input.model)
  const familySourceUrl = providerSourceUrl(family)
  const sourceUrl = hostedProviderFamily(family) ? familySourceUrl ?? modelConfig.sourceUrl : modelConfig.sourceUrl ?? familySourceUrl
  const sourceConfidence = sourceUrl ? 'source-backed' : 'inferred'

  return {
    id: `${family}:${input.model}`,
    family,
    protocol,
    providerType: provider.type,
    model: input.model,
    transport: {
      streaming: provider.capabilities?.streaming !== false && modelConfig.supportsStreaming !== false,
      preferredEndpoint: modelConfig.preferredEndpoint,
    },
    context: {
      windowTokens: modelConfig.contextWindow,
      maxOutputTokens: modelConfig.maxOutputTokens,
    },
    modalities: {
      input: {
        text: true,
        image: providerCapabilitySupported(provider, modelConfig, 'vision', modelConfig.supportsVision),
        file: providerCapabilitySupported(provider, modelConfig, 'files', modelConfig.supportsFiles),
        audio: providerAudioInputSupported(provider),
        video: family === 'minimax' && isMiniMaxM3Model(input.provider, input.model),
      },
      output: {
        text: true,
        speech: providerSpeechOutputSupported(provider),
      },
    },
    reasoning: {
      supported: requestShape !== 'none' && selectableEfforts.length > 0,
      requestShape,
      selectableEfforts,
      disablesSamplingWhenEnabled: reasoningDisablesSampling(requestShape),
      minBudgetTokens: requestShape === 'anthropic-budget' ? 1024 : undefined,
    },
    payload: {
      maxTokensField: inferMaxTokensField(input, family, protocol),
      samplingFields: ['temperature', 'top_p', 'topP'],
      unsupportedFieldsWhenReasoning: reasoningUnsupportedPayloadFields(requestShape),
      requiresReasoningStatePassthrough: reasoningRequiresStatePassthrough(family, requestShape),
      streamUsageField: streamUsageField(family, protocol),
      reasoningStatePreservationField: reasoningStatePreservationField(family, requestShape),
      reasoningOutputSplitField: reasoningOutputSplitField(input, family, protocol),
      reasoningSummaryField: reasoningSummaryField(family, protocol),
    },
    tools: {
      supported: supportsNativeProviderTools(provider, modelConfig),
      requestShape: inferToolRequestShape(family, protocol),
      nativeWebSearchToolType: nativeWebSearchToolType(input, family, protocol),
    },
    structuredOutput: inferStructuredOutput(input, family, protocol),
    source: {
      url: sourceUrl,
      verifiedAt: modelConfig.verifiedAt ?? providerSourceVerifiedAt(family),
      confidence: sourceConfidence,
    },
  }
}

export function resolveAndHardenProviderRequest(input: ProviderConformanceRequest, body: Record<string, unknown>): ProviderBodyConformanceResult {
  const manifest = resolveProviderCapabilityManifest(input)
  const issues: ProviderConformanceIssue[] = []
  const removedParams: string[] = []
  const adjustedParams: Record<string, unknown> = {}
  const next = { ...body }
  const reasoning = resolveReasoning(input, manifest, issues)

  for (const modality of requestedModalities(input.attachments)) {
    if (!modalitySupported(manifest, modality)) {
      issues.push({
        code: 'unsupported_modality',
        severity: 'block',
        message: `provider does not support ${modality} input`,
        field: modality,
      })
    }
  }

  if (manifest.source.confidence === 'inferred') {
    issues.push({
      code: 'provider_manifest_inferred',
      severity: 'info',
      message: 'provider capability manifest is inferred from protocol and model id',
    })
  }

  const removeFields = (fields: string[]) => {
    for (const field of fields) {
      if (field in next) {
        delete next[field]
        if (!removedParams.includes(field)) removedParams.push(field)
      }
    }
  }

  if (!manifest.tools.supported) {
    const toolFields = ['tools', 'tool_choice', 'parallel_tool_calls']
    if (toolFields.some((field) => field in next)) {
      removeFields(toolFields)
      issues.push({
        code: 'unsupported_tools',
        severity: 'block',
        message: 'provider does not support tool declarations',
        field: 'tools',
      })
    }
  }

  if (
    input.structuredOutput?.type === 'json_schema' &&
    manifest.structuredOutput.appRequestControl &&
    manifest.structuredOutput.documentedRequestShape === 'openai-json-object-response-format'
  ) {
    removeFields(['response_format'])
    issues.push({
      code: 'unsupported_structured_output',
      severity: 'block',
      message: 'provider supports JSON object mode but does not document JSON schema request controls',
      field: 'response_format',
      requested: input.structuredOutput.type,
      effective: 'json_object',
    })
  } else if (input.structuredOutput && !manifest.structuredOutput.appRequestControl) {
    removeFields(['response_format'])
    issues.push({
      code: 'unsupported_structured_output',
      severity: 'block',
      message: 'provider does not support structured-output request controls in IsleMind',
      field: 'response_format',
    })
  } else if (!manifest.structuredOutput.appRequestControl && 'response_format' in next) {
    removeFields(['response_format'])
    issues.push({
      code: 'unsupported_structured_output',
      severity: 'block',
      message: 'provider response_format is not covered by the compatibility contract',
      field: 'response_format',
    })
  }

  if (modelDisallowsAnthropicSampling(manifest.model)) {
    removeFields(manifest.payload.samplingFields)
  }
  if (reasoning.enabled) {
    if (manifest.reasoning.disablesSamplingWhenEnabled) removeFields(manifest.payload.samplingFields)
    removeFields(manifest.payload.unsupportedFieldsWhenReasoning)
  }

  normalizeAnthropicThinkingBudget(next, manifest, issues, adjustedParams)
  clampTopLevelMaxTokens(next, manifest, issues, adjustedParams)

  if (removedParams.length) {
    issues.push({
      code: 'param_conflict_removed',
      severity: 'info',
      message: 'provider conformance removed sampling parameters that conflict with model capability or active reasoning',
      field: removedParams.join(','),
    })
  }

  return {
    body: next,
    conformance: {
      manifest,
      reasoning,
      requestedModalities: requestedModalities(input.attachments),
      issues,
      removedParams,
      adjustedParams,
      bodyKeys: Object.keys(next).sort(),
    },
  }
}

export function applyProviderConformanceToBody(input: ProviderConformanceRequest, body: Record<string, unknown>): Record<string, unknown> {
  return resolveAndHardenProviderRequest(input, body).body
}

export function resolveProviderRequestConformance(input: ProviderConformanceRequest, body: Record<string, unknown>): ProviderConformanceResult {
  return resolveAndHardenProviderRequest(input, body).conformance
}

function inferProviderConformanceFamily(provider: AIProvider): ProviderConformanceFamily {
  if (matchesProviderPreset(provider, 'azure-openai') || matchesProviderFamily(provider, undefined, /azure[-_ ]?openai|microsoft foundry|openai\.azure\.com|services\.ai\.azure\.com/i)) return 'azure-openai'
  if (matchesProviderPreset(provider, 'aws-bedrock') || matchesProviderFamily(provider, undefined, /\bbedrock\b|amazon bedrock|bedrock-runtime|bedrock-mantle/i)) return 'aws-bedrock'
  if (matchesProviderPreset(provider, 'vertex-ai') || matchesProviderFamily(provider, undefined, /vertex[-_ ]?ai|google cloud vertex|aiplatform\.googleapis\.com/i)) return 'vertex-ai'
  if (provider.type === 'openai') return 'openai'
  if (provider.type === 'anthropic') return 'anthropic'
  if (provider.type === 'google') return 'google'
  if (provider.type === 'xiaomi-mimo') return 'xiaomi-mimo'
  if (matchesProviderPreset(provider, 'deepseek')) return 'deepseek'
  if (matchesProviderPreset(provider, 'dashscope')) return 'dashscope'
  if (matchesProviderPreset(provider, 'moonshot')) return 'moonshot'
  if (matchesProviderPreset(provider, 'xai')) return 'xai'
  if (matchesProviderPreset(provider, 'bigmodel')) return 'bigmodel'
  if (matchesProviderPreset(provider, 'baidu-qianfan')) return 'baidu-qianfan'
  if (matchesProviderPreset(provider, 'baichuan')) return 'baichuan'
  if (matchesProviderPreset(provider, 'zero-one')) return 'zero-one'
  if (matchesProviderPreset(provider, 'stepfun')) return 'stepfun'
  if (matchesProviderPreset(provider, 'minimax')) return 'minimax'
  if (matchesProviderPreset(provider, 'mistral')) return 'mistral'
  if (matchesProviderPreset(provider, 'groq')) return 'groq'
  if (matchesProviderPreset(provider, 'together')) return 'together'
  if (matchesProviderPreset(provider, 'fireworks')) return 'fireworks'
  if (matchesProviderPreset(provider, 'perplexity')) return 'perplexity'
  if (matchesProviderPreset(provider, 'cohere')) return 'cohere'
  if (matchesProviderPreset(provider, 'cerebras')) return 'cerebras'
  if (matchesProviderPreset(provider, 'sambanova')) return 'sambanova'
  if (matchesProviderPreset(provider, 'nvidia-nim')) return 'nvidia-nim'
  if (matchesProviderPreset(provider, 'huggingface')) return 'huggingface'
  if (matchesProviderPreset(provider, 'github-models')) return 'github-models'
  if (matchesProviderPreset(provider, 'deepinfra')) return 'deepinfra'
  if (matchesProviderPreset(provider, 'novita')) return 'novita'
  if (matchesProviderPreset(provider, 'siliconflow')) return 'siliconflow'
  if (matchesProviderPreset(provider, 'modelscope')) return 'modelscope'
  if (matchesProviderPreset(provider, 'tencent-hunyuan')) return 'tencent-hunyuan'
  if (matchesProviderPreset(provider, 'volcengine-ark')) return 'volcengine-ark'
  if (matchesProviderPreset(provider, 'ollama')) return 'ollama'
  if (matchesProviderPreset(provider, 'lm-studio')) return 'lm-studio'
  if (matchesProviderPreset(provider, 'localai')) return 'localai'
  if (matchesProviderPreset(provider, 'vllm')) return 'vllm'
  if (matchesProviderPreset(provider, 'sglang')) return 'sglang'
  if (matchesProviderPreset(provider, 'openrouter')) return 'openrouter'
  if (matchesProviderPreset(provider, 'newapi')) return 'newapi'
  if (matchesProviderPreset(provider, 'sub2api')) return 'sub2api'
  if (provider.presetId === 'deepseek' || provider.detectedPresetId === 'deepseek' || (provider.baseUrl ?? '').toLowerCase().includes('deepseek')) return 'deepseek'
  if (matchesProviderFamily(provider, 'dashscope', /qwen|qwq|qvq|dashscope|tongyi|aliyun|alibaba|百炼|阿里/i)) return 'dashscope'
  if (matchesProviderFamily(provider, 'moonshot', /kimi|moonshot/i)) return 'moonshot'
  if (matchesProviderFamily(provider, 'xai', /grok|(^|[-_./])xai($|[-_./])|api\.x\.ai/i)) return 'xai'
  if (matchesProviderFamily(provider, 'bigmodel', /glm|bigmodel|zhipu|智谱/i)) return 'bigmodel'
  if (matchesProviderFamily(provider, 'baidu-qianfan', /qianfan|ernie|baidu|qianfan\.baidubce\.com|aip\.baidubce\.com|千帆|文心/i)) return 'baidu-qianfan'
  if (matchesProviderFamily(provider, 'baichuan', /baichuan|baichuan-ai\.com|百川/i)) return 'baichuan'
  if (matchesProviderFamily(provider, 'zero-one', /01\.ai|zero[-_ ]?one|lingyiwanwu|yi-|零一万物/i)) return 'zero-one'
  if (matchesProviderFamily(provider, 'stepfun', /stepfun|api\.stepfun\.com|阶跃/i)) return 'stepfun'
  if (matchesProviderFamily(provider, 'minimax', /minimax|mini[-_ ]?max|minimaxi|海螺/i)) return 'minimax'
  if (matchesProviderFamily(provider, 'mistral', /mistral|magistral|codestral|api\.mistral\.ai/i)) return 'mistral'
  if (matchesProviderFamily(provider, 'groq', /groq|api\.groq\.com/i)) return 'groq'
  if (matchesProviderFamily(provider, 'together', /together|api\.together\.(ai|xyz)/i)) return 'together'
  if (matchesProviderFamily(provider, 'fireworks', /fireworks|api\.fireworks\.ai/i)) return 'fireworks'
  if (matchesProviderFamily(provider, 'perplexity', /perplexity|sonar|api\.perplexity\.ai/i)) return 'perplexity'
  if (matchesProviderFamily(provider, 'cohere', /cohere|api\.cohere\.(ai|com)/i)) return 'cohere'
  if (matchesProviderFamily(provider, 'cerebras', /cerebras|api\.cerebras\.ai/i)) return 'cerebras'
  if (matchesProviderFamily(provider, 'sambanova', /sambanova|api\.sambanova\.ai/i)) return 'sambanova'
  if (matchesProviderFamily(provider, 'nvidia-nim', /nvidia|integrate\.api\.nvidia\.com|build\.nvidia\.com/i)) return 'nvidia-nim'
  if (matchesProviderFamily(provider, 'huggingface', /hugging\s*face|huggingface|router\.huggingface\.co|api-inference\.huggingface\.co|hf\.co/i)) return 'huggingface'
  if (matchesProviderFamily(provider, 'github-models', /github\s*models|github-models|models\.github\.ai/i)) return 'github-models'
  if (matchesProviderFamily(provider, 'deepinfra', /deepinfra|api\.deepinfra\.com/i)) return 'deepinfra'
  if (matchesProviderFamily(provider, 'novita', /novita|api\.novita\.ai/i)) return 'novita'
  if (matchesProviderFamily(provider, 'siliconflow', /siliconflow|silicon\s*flow|api\.siliconflow\.(cn|com)|硅基流动/i)) return 'siliconflow'
  if (matchesProviderFamily(provider, 'modelscope', /modelscope|model\s*scope|api-inference\.modelscope\.cn|魔搭/i)) return 'modelscope'
  if (matchesProviderFamily(provider, 'tencent-hunyuan', /hunyuan|tencent|api\.hunyuan\.cloud\.tencent\.com|混元|腾讯/i)) return 'tencent-hunyuan'
  if (matchesProviderFamily(provider, 'volcengine-ark', /volcengine|volces\.com|doubao|火山|豆包/i)) return 'volcengine-ark'
  if (provider.wireProtocol === 'anthropic-compatible') return 'anthropic-compatible'
  if (matchesProviderFamily(provider, 'ollama', /ollama|localhost:11434|127\.0\.0\.1:11434/i)) return 'ollama'
  if (matchesProviderFamily(provider, 'lm-studio', /lm[-_ ]?studio|lmstudio|localhost:1234|127\.0\.0\.1:1234/i)) return 'lm-studio'
  if (matchesProviderFamily(provider, 'localai', /localai|local\s*ai|localhost:8080|127\.0\.0\.1:8080/i)) return 'localai'
  if (matchesProviderFamily(provider, 'vllm', /vllm|localhost:8000|127\.0\.0\.1:8000/i)) return 'vllm'
  if (matchesProviderFamily(provider, 'sglang', /sglang|localhost:30000|127\.0\.0\.1:30000/i)) return 'sglang'
  if (matchesProviderFamily(provider, 'openrouter', /openrouter/i)) return 'openrouter'
  if (matchesProviderFamily(provider, 'newapi', /newapi|new-api|oneapi|one-api/i)) return 'newapi'
  if (matchesProviderFamily(provider, 'sub2api', /sub2api/i)) return 'sub2api'
  return 'openai-compatible'
}

function matchesProviderPreset(provider: AIProvider, presetId: string): boolean {
  return provider.presetId === presetId || provider.detectedPresetId === presetId
}

function matchesProviderFamily(provider: AIProvider, presetId: string | undefined, pattern: RegExp): boolean {
  if (presetId && (provider.presetId === presetId || provider.detectedPresetId === presetId)) return true
  const text = [provider.id, provider.name, provider.baseUrl, provider.models?.join(' ')].filter(Boolean).join(' ')
  return pattern.test(text)
}

function isMiniMaxM3Model(provider: AIProvider, model: string): boolean {
  return isMiniMaxThinkingModel(provider, model)
}

function inferProtocol(input: ProviderConformanceRequest, family: ProviderConformanceFamily): ProviderConformanceProtocol {
  if (family === 'openai') {
    const config = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
    return config.preferredEndpoint === 'responses' || input.webSearchMode === 'native' ? 'openai-responses' : 'openai-chat-completions'
  }
  if (family === 'anthropic') return 'anthropic-messages'
  if (family === 'google') return 'google-generate-content'
  if (family === 'deepseek') return 'openai-compatible'
  if (family === 'minimax') return input.provider.wireProtocol === 'anthropic-compatible' ? 'anthropic-compatible' : 'openai-compatible'
  if (family === 'xai') {
    const config = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
    return config.preferredEndpoint === 'responses' && providerResponsesApiCanBeSent(input.provider) ? 'openai-responses' : 'openai-compatible'
  }
  if (family === 'aws-bedrock' && isBedrockRuntimeProvider(input.provider)) return 'anthropic-messages'
  if (usesOpenAIResponsesProtocol(input, family)) {
    const config = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
    return config.preferredEndpoint === 'responses' || input.webSearchMode === 'native' ? 'openai-responses' : 'openai-compatible'
  }
  if (['dashscope', 'moonshot', 'bigmodel', 'baidu-qianfan', 'baichuan', 'zero-one', 'stepfun', 'mistral', 'groq', 'together', 'fireworks', 'perplexity', 'cohere', 'cerebras', 'sambanova', 'nvidia-nim', 'huggingface', 'github-models', 'deepinfra', 'novita', 'siliconflow', 'modelscope', 'tencent-hunyuan', 'volcengine-ark', 'azure-openai', 'aws-bedrock', 'vertex-ai', 'ollama', 'lm-studio', 'vllm', 'sglang', 'openrouter', 'newapi', 'sub2api'].includes(family)) return 'openai-compatible'
  if (family === 'xiaomi-mimo') return input.provider.wireProtocol === 'anthropic-compatible' ? 'xiaomi-mimo-anthropic-compatible' : 'xiaomi-mimo-openai-compatible'
  if (family === 'anthropic-compatible') return 'anthropic-compatible'
  return 'openai-compatible'
}

function usesOpenAIResponsesProtocol(input: ProviderConformanceRequest, family: ProviderConformanceFamily): boolean {
  if (input.provider.wireProtocol === 'anthropic-compatible') return false
  if (input.provider.capabilities?.responsesApi !== true || !providerResponsesApiCanBeSent(input.provider)) return false
  return [
    'openai-compatible',
    'dashscope',
    'moonshot',
    'bigmodel',
    'mistral',
    'groq',
    'fireworks',
    'sambanova',
    'huggingface',
    'azure-openai',
    'aws-bedrock',
    'vertex-ai',
    'ollama',
    'lm-studio',
    'vllm',
    'openrouter',
    'newapi',
    'sub2api',
  ].includes(family)
}

function providerResponsesApiCanBeSent(provider: AIProvider): boolean {
  return providerCompatibilityCapabilityCanBeSentForProvider(provider, 'responsesApi', provider.capabilities?.responsesApi === true)
}

function inferReasoningRequestShape(input: ProviderConformanceRequest, family: ProviderConformanceFamily, protocol: ProviderConformanceProtocol): ProviderReasoningRequestShape {
  const config = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
  if (!providerReasoningCanBeSent(input.provider, config)) return 'none'
  if (customProtocolReferenceDisablesCapability(input.provider, config, 'reasoningEffort')) return 'none'
  if (family === 'openai' && isOpenAIReasoningModel(input.provider, input.model)) {
    return protocol === 'openai-responses' ? 'openai-responses-reasoning' : 'openai-reasoning-effort'
  }
  if (family === 'anthropic' || family === 'anthropic-compatible') {
    if (config.reasoningMode === 'anthropic-thinking' || isClaudeThinkingModel(input.provider, input.model)) {
      if (usesAnthropicOutputConfigOnlyThinkingModel(input.model)) return 'anthropic-output-config-effort'
      return supportsAnthropicAdaptiveThinkingModel(input.model) ? 'anthropic-adaptive' : 'anthropic-budget'
    }
  }
  if (family === 'google' && isGeminiThinkingModel(input.provider, input.model)) {
    return isGeminiThinkingLevelModel(input.model) || config.reasoningMode === 'gemini-thinking-level' ? 'gemini-thinking-level' : 'gemini-thinking-budget'
  }
  if (family === 'deepseek' && (config.reasoningMode === 'deepseek-thinking' || isDeepSeekThinkingModel(input.provider, input.model))) return 'deepseek-thinking'
  if (family === 'dashscope' && (config.reasoningMode === 'dashscope-thinking' || isDashScopeThinkingModel(input.provider, input.model))) return 'dashscope-thinking'
  if (family === 'moonshot' && (config.reasoningMode === 'kimi-thinking' || isKimiThinkingModel(input.provider, input.model))) return 'kimi-thinking'
  if (family === 'minimax' && config.reasoningMode === 'minimax-thinking' && isMiniMaxThinkingModel(input.provider, input.model)) return 'minimax-thinking'
  if (family === 'xai' && (config.reasoningMode === 'xai-reasoning-effort' || isXAIReasoningModel(input.provider, input.model))) return 'xai-reasoning-effort'
  if (family === 'ollama' && config.reasoningMode === 'openai-effort') return 'openai-reasoning-effort'
  if (family === 'lm-studio' && config.reasoningMode === 'openai-effort') return protocol === 'openai-responses' ? 'openai-responses-reasoning' : 'none'
  if (family === 'vllm' && config.reasoningMode === 'openai-effort') return protocol === 'openai-responses' ? 'openai-responses-reasoning' : 'openai-reasoning-effort'
  if (family === 'newapi' && config.reasoningMode === 'openai-effort') return protocol === 'openai-responses' ? 'openai-responses-reasoning' : 'openai-reasoning-effort'
  if (family === 'azure-openai' && config.reasoningMode === 'openai-effort') return protocol === 'openai-responses' ? 'openai-responses-reasoning' : 'none'
  if (family === 'groq' && (config.reasoningMode === 'groq-reasoning-effort' || isGroqReasoningModel(input.provider, input.model))) return 'groq-reasoning-effort'
  if (family === 'together' && (config.reasoningMode === 'together-reasoning-effort' || isTogetherReasoningModel(input.provider, input.model))) return 'together-reasoning-effort'
  if (family === 'fireworks' && (config.reasoningMode === 'fireworks-reasoning-effort' || isFireworksReasoningModel(input.provider, input.model))) return 'fireworks-reasoning-effort'
  if (family === 'perplexity' && (config.reasoningMode === 'perplexity-reasoning-effort' || isPerplexityReasoningModel(input.provider, input.model))) return 'perplexity-reasoning-effort'
  if (family === 'cohere' && (config.reasoningMode === 'cohere-reasoning-effort' || isCohereReasoningModel(input.provider, input.model))) return 'cohere-reasoning-effort'
  if (family === 'cerebras' && (config.reasoningMode === 'cerebras-reasoning-effort' || isCerebrasReasoningModel(input.provider, input.model))) return 'cerebras-reasoning-effort'
  if (family === 'sambanova' && (config.reasoningMode === 'sambanova-reasoning-effort' || isSambaNovaReasoningModel(input.provider, input.model))) return 'sambanova-reasoning-effort'
  if (family === 'huggingface' && (config.reasoningMode === 'huggingface-reasoning-effort' || isHuggingFaceReasoningModel(input.provider, input.model))) return 'huggingface-reasoning-effort'
  if (family === 'deepinfra' && (config.reasoningMode === 'deepinfra-reasoning-effort' || isDeepInfraReasoningModel(input.provider, input.model))) return 'deepinfra-reasoning-effort'
  if (family === 'siliconflow' && (config.reasoningMode === 'siliconflow-thinking-budget' || isSiliconFlowReasoningModel(input.provider, input.model))) return 'siliconflow-thinking-budget'
  if (family === 'xiaomi-mimo' && isXiaomiMimoReasoningModel(input.provider, input.model)) return 'xiaomi-mimo-thinking'
  return 'none'
}

function providerReasoningCanBeSent(
  provider: AIProvider,
  modelConfig: ReturnType<typeof getModelConfig>
): boolean {
  const explicitDeclaration = providerCompatibilityReasoningExplicitlyDeclaredForModel(provider, modelConfig)
  return providerCompatibilityCapabilityCanBeSentForProvider(provider, 'reasoning', explicitDeclaration)
}

function inferMaxTokensField(
  input: ProviderConformanceRequest,
  family: ProviderConformanceFamily,
  protocol: ProviderConformanceProtocol
): ProviderCapabilityManifest['payload']['maxTokensField'] {
  if (protocol === 'openai-responses') return 'max_output_tokens'
  if (family === 'google') return 'generationConfig.maxOutputTokens'
  if (family === 'xiaomi-mimo') {
    return input.provider.wireProtocol === 'anthropic-compatible' ? 'max_tokens' : 'max_completion_tokens'
  }
  if (family === 'minimax') {
    return protocol === 'anthropic-compatible' ? 'max_tokens' : 'max_completion_tokens'
  }
  if (family === 'moonshot') {
    return 'max_completion_tokens'
  }
  if (family === 'groq') {
    return 'max_completion_tokens'
  }
  if (family === 'cerebras') {
    return 'max_completion_tokens'
  }
  if (family === 'together') {
    return 'max_tokens'
  }
  if (family === 'fireworks') {
    return 'max_tokens'
  }
  if (family === 'xai') {
    return 'max_completion_tokens'
  }
  if (family === 'openai') {
    return 'max_completion_tokens'
  }
  return 'max_tokens'
}

function inferToolRequestShape(
  family: ProviderConformanceFamily,
  protocol: ProviderConformanceProtocol
): ProviderToolRequestShape {
  if (family === 'google') return 'google-tools'
  if (protocol === 'anthropic-messages') return 'anthropic-tools'
  if (family === 'anthropic' || family === 'anthropic-compatible' || protocol === 'xiaomi-mimo-anthropic-compatible') return 'anthropic-tools'
  if (
    protocol === 'openai-chat-completions' ||
    protocol === 'openai-responses' ||
    protocol === 'openai-compatible' ||
    protocol === 'xiaomi-mimo-openai-compatible'
  ) {
    return 'openai-tools'
  }
  return 'none'
}

function inferStructuredOutput(
  input: ProviderConformanceRequest,
  family: ProviderConformanceFamily,
  protocol: ProviderConformanceProtocol
): ProviderCapabilityManifest['structuredOutput'] {
  const compatibilityId = getProviderCompatibilityEvidenceForProvider(input.provider).id
  const contractClaimed = providerCompatibilityCapabilityCanBeSent(compatibilityId, 'structuredOutput')
  const appRequestControl = contractClaimed && structuredOutputAppRequestControl(input, family, protocol)
  return {
    contractClaimed,
    documentedRequestShape: contractClaimed ? inferStructuredOutputRequestShape(family, protocol) : 'none',
    appRequestControl,
    jsonObjectMode: appRequestControl,
    strictJsonSchema: appRequestControl && (family === 'openai' || family === 'openrouter' || family === 'xai' || family === 'cerebras' || family === 'ollama' || family === 'lm-studio'),
  }
}

function inferStructuredOutputRequestShape(
  family: ProviderConformanceFamily,
  protocol: ProviderConformanceProtocol
): ProviderStructuredOutputRequestShape {
  if (family === 'deepseek') return 'openai-json-object-response-format'
  if (family === 'openrouter') return 'openrouter-response-format'
  if (family === 'xai') return 'xai-response-format'
  if (family === 'localai') return 'localai-grammar'
  if (family === 'google' || protocol === 'google-generate-content') return 'google-response-schema'
  if (protocol === 'anthropic-messages' || protocol === 'anthropic-compatible') return 'anthropic-tool-schema'
  return 'openai-response-format'
}

function structuredOutputAppRequestControl(
  input: ProviderConformanceRequest,
  family: ProviderConformanceFamily,
  protocol: ProviderConformanceProtocol
): boolean {
  if (family === 'openai' && (protocol === 'openai-responses' || protocol === 'openai-chat-completions')) return true
  if (family === 'anthropic' && protocol === 'anthropic-messages') return true
  if (family === 'google' || protocol === 'google-generate-content') return true
  if (family === 'deepseek' && protocol === 'openai-compatible') return true
  if (family === 'openrouter' && (protocol === 'openai-compatible' || protocol === 'openai-responses')) return openRouterModelSupportsStructuredOutput(input)
  if (family === 'ollama' && protocol === 'openai-compatible') return true
  if (family === 'lm-studio' && protocol === 'openai-compatible') return true
  if (family === 'azure-openai' && protocol === 'openai-compatible') return true
  if (family === 'vertex-ai' && protocol === 'openai-compatible') return true
  if (family === 'vllm' && protocol === 'openai-compatible') return true
  if (family === 'sglang' && protocol === 'openai-compatible') return true
  if (family === 'newapi' && protocol === 'openai-compatible') return true
  if (family === 'xai' && (protocol === 'openai-responses' || protocol === 'openai-compatible')) return true
  return protocol === 'openai-compatible' && (family === 'cerebras' || family === 'sambanova')
}

function openRouterModelSupportsStructuredOutput(input: ProviderConformanceRequest): boolean {
  const modelConfig = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
  const supportedParameters = modelConfig.supportedParameters?.map((item) => item.toLowerCase())
  if (!supportedParameters?.length) return true
  return supportedParameters.includes('response_format') || supportedParameters.includes('structured_outputs')
}

function nativeWebSearchToolType(
  input: ProviderConformanceRequest,
  family: ProviderConformanceFamily,
  protocol: ProviderConformanceProtocol
): ProviderCapabilityManifest['tools']['nativeWebSearchToolType'] {
  if (input.webSearchMode !== 'native') return undefined
  const modelConfig = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
  if (customProtocolReferenceDisablesCapability(input.provider, modelConfig, 'nativeSearch')) return undefined
  if (family === 'openai' && protocol === 'openai-responses') return 'web_search_preview'
  if (family === 'xai' && protocol === 'openai-responses') return 'web_search'
  if (family === 'xiaomi-mimo' && protocol === 'xiaomi-mimo-openai-compatible') {
    return supportsXiaomiMimoNativeWebSearch(input.model) ? 'web_search' : undefined
  }
  if (family === 'anthropic' || family === 'anthropic-compatible') {
    return supportsAnthropicDynamicWebSearchModel(input.model) ? 'web_search_20260209' : 'web_search_20250305'
  }
  return undefined
}

export function supportsNativeProviderTools(provider: AIProvider, modelConfig: ReturnType<typeof getModelConfig>): boolean {
  if (modelConfig.chatCompatible === false) return false
  if (modelConfig.supportsTools === false) return false
  const explicitDeclaration = provider.capabilities?.nativeTools === true || modelConfig.supportsTools === true
  if (!providerCompatibilityCapabilityCanBeSentForProvider(provider, 'tools', explicitDeclaration)) return false
  if (modelConfig.supportsTools === true) {
    return !customProtocolReferenceDisablesCapability(provider, modelConfig, 'nativeTools')
  }
  if (provider.capabilities?.nativeTools === true) return true
  if (provider.capabilities?.nativeTools === false) return false
  return provider.type === 'openai' || provider.type === 'anthropic' || provider.type === 'google'
}

function providerCapabilitySupported(
  provider: AIProvider,
  modelConfig: ReturnType<typeof getModelConfig>,
  capability: 'vision' | 'files',
  modelSupported: boolean
): boolean {
  const explicitDeclaration = modelSupported || provider.capabilities?.[capability] === true
  if (!providerCompatibilityCapabilityCanBeSentForProvider(provider, capability, explicitDeclaration)) return false
  if (modelSupported) {
    return !customProtocolReferenceDisablesCapability(provider, modelConfig, capability)
  }
  return provider.capabilities?.[capability] === true
}

function providerAudioInputSupported(provider: AIProvider): boolean {
  return provider.capabilities?.audioInput === true &&
    providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', true)
}

function providerSpeechOutputSupported(provider: AIProvider): boolean {
  return provider.capabilities?.speech === true &&
    providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', true)
}

function customProtocolReferenceDisablesCapability(
  provider: AIProvider,
  modelConfig: ReturnType<typeof getModelConfig>,
  capability: 'vision' | 'files' | 'nativeTools' | 'nativeSearch' | 'reasoningEffort'
): boolean {
  if (!isCustomProtocolReferenceProvider(provider)) return false
  if (modelConfig.source === 'remote') return false
  return provider.capabilities?.[capability] !== true
}

function isCustomProtocolReferenceProvider(provider: AIProvider): boolean {
  return provider.presetId === 'custom-openai-compatible' ||
    provider.presetId === 'custom-anthropic-compatible' ||
    provider.detectedPresetId === 'custom-openai-compatible' ||
    provider.detectedPresetId === 'custom-anthropic-compatible'
}

function supportsAnthropicDynamicWebSearchModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase().split('/').at(-1) ?? modelId.toLowerCase()
  return /^claude-(fable-5|mythos-5|mythos-preview|opus-4-[678]|sonnet-4-6)/.test(normalized)
}

function resolveReasoning(input: ProviderConformanceRequest, manifest: ProviderCapabilityManifest, issues: ProviderConformanceIssue[]): ProviderReasoningResolution {
  const requested = input.reasoningEffort
  if (!requested || !manifest.reasoning.supported || reasoningEffortDisables(manifest.reasoning.requestShape, requested, manifest.reasoning.selectableEfforts)) {
    return { requested, enabled: false, requestShape: manifest.reasoning.requestShape }
  }
  const supported = manifest.reasoning.selectableEfforts
  if (manifest.reasoning.requestShape === 'cerebras-reasoning-effort' && supported.length === 1 && supported[0] === 'none' && requested !== 'none') {
    return { requested, enabled: false, requestShape: manifest.reasoning.requestShape }
  }
  const effective = supported.includes(requested) ? requested : downgradeReasoningEffort(requested, supported)
  if (effective !== requested) {
    issues.push({
      code: 'reasoning_effort_downgraded',
      severity: 'warn',
      message: 'requested reasoning effort is not supported by this model',
      requested,
      effective,
    })
  }
  if (manifest.reasoning.requestShape === 'xiaomi-mimo-thinking' && effective && !OFF_EFFORTS.has(effective)) {
    return {
      requested,
      enabled: false,
      effective,
      requestShape: manifest.reasoning.requestShape,
      downgradeReason: 'provider_parameter_guard',
    }
  }
  return {
    requested,
    enabled: true,
    effective,
    providerValue: providerReasoningValue(manifest.reasoning.requestShape, effective, manifest.model),
    requestShape: manifest.reasoning.requestShape,
    downgradeReason: effective !== requested ? 'unsupported_effort' : undefined,
  }
}

function reasoningEffortDisables(shape: ProviderReasoningRequestShape, effort: ReasoningEffort, supported: ReasoningEffort[] = []): boolean {
  if (effort === 'none') {
    if (shape === 'cerebras-reasoning-effort') return !supported.includes('none')
    return !['gemini-thinking-level', 'cohere-reasoning-effort', 'deepinfra-reasoning-effort'].includes(shape)
  }
  if (effort !== 'minimal') return false
  return [
    'anthropic-output-config-effort',
    'anthropic-adaptive',
    'anthropic-budget',
    'deepseek-thinking',
    'dashscope-thinking',
    'siliconflow-thinking-budget',
    'kimi-thinking',
  ].includes(shape)
}

function providerReasoningValue(shape: ProviderReasoningRequestShape, effort: ReasoningEffort | undefined, model: string): string | number | boolean | undefined {
  if (!effort) return undefined
  if (shape === 'deepseek-thinking') return effort === 'xhigh' || effort === 'max' ? 'max' : 'high'
  if (shape === 'dashscope-thinking') return OFF_EFFORTS.has(effort) ? false : dashScopeThinkingBudgetValue(model, effort)
  if (shape === 'kimi-thinking') return OFF_EFFORTS.has(effort) ? 'disabled' : 'enabled'
  if (shape === 'minimax-thinking') return OFF_EFFORTS.has(effort) ? 'disabled' : 'adaptive'
  if (shape === 'xai-reasoning-effort') {
    if (isXAIMultiAgentReasoningModel(model)) {
      if (effort === 'xhigh' || effort === 'max') return 'xhigh'
      if (effort === 'high') return 'high'
      if (effort === 'medium') return 'medium'
      return 'low'
    }
    if (effort === 'high' || effort === 'xhigh' || effort === 'max') return 'high'
    if (effort === 'medium') return 'medium'
    return 'low'
  }
  if (shape === 'groq-reasoning-effort') {
    if (effort === 'none') return 'none'
    if (effort === 'high' || effort === 'xhigh' || effort === 'max') return 'high'
    if (effort === 'medium') return 'medium'
    return 'low'
  }
  if (shape === 'together-reasoning-effort') {
    if (effort === 'high' || effort === 'xhigh' || effort === 'max') return 'high'
    if (effort === 'medium') return 'medium'
    return 'low'
  }
  if (shape === 'fireworks-reasoning-effort') return normalizeFireworksReasoningEffort(model, effort)
  if (shape === 'perplexity-reasoning-effort') {
    if (effort === 'none') return undefined
    if (effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high') return effort
    return 'high'
  }
  if (shape === 'cohere-reasoning-effort') {
    return effort === 'none' ? 'none' : 'high'
  }
  if (shape === 'cerebras-reasoning-effort') {
    if (effort === 'none') return 'none'
    if (effort === 'xhigh' || effort === 'max') return 'high'
    if (effort === 'minimal') return 'low'
    return effort
  }
  if (shape === 'sambanova-reasoning-effort') {
    if (effort === 'none') return undefined
    if (effort === 'xhigh' || effort === 'max') return 'high'
    if (effort === 'minimal') return 'low'
    return ['low', 'medium', 'high'].includes(effort) ? effort : 'medium'
  }
  if (shape === 'huggingface-reasoning-effort') {
    if (effort === 'none') return undefined
    if (effort === 'xhigh' || effort === 'max') return 'high'
    if (effort === 'minimal') return 'low'
    return ['low', 'medium', 'high'].includes(effort) ? effort : 'medium'
  }
  if (shape === 'deepinfra-reasoning-effort') {
    if (effort === 'none') return 'none'
    if (effort === 'xhigh' || effort === 'max') return 'high'
    if (effort === 'minimal') return 'low'
    return ['low', 'medium', 'high'].includes(effort) ? effort : 'medium'
  }
  if (shape === 'siliconflow-thinking-budget') return OFF_EFFORTS.has(effort) ? undefined : siliconFlowThinkingBudgetValue(effort)
  if (shape === 'xiaomi-mimo-thinking') return OFF_EFFORTS.has(effort) ? 'disabled' : 'enabled'
  if (shape === 'anthropic-output-config-effort' || shape === 'anthropic-adaptive') {
    if (effort === 'max') return 'max'
    if (effort === 'xhigh') return /claude-(fable-5|mythos-5|opus-4-[78])/i.test(model) ? 'xhigh' : 'max'
    return effort
  }
  if (shape === 'anthropic-budget') {
    if (effort === 'low') return 1024
    if (effort === 'high') return 4096
    if (effort === 'xhigh' || effort === 'max') return 8192
    return 2048
  }
  if (shape === 'gemini-thinking-budget') {
    return geminiThinkingBudgetValue(model, effort)
  }
  return effort
}

function geminiThinkingBudgetValue(model: string, effort: ReasoningEffort): number {
  const normalized = model.toLowerCase()
  const max = normalized.includes('flash') ? 24576 : 32768
  const canDisable = normalized.includes('flash')
  switch (effort) {
    case 'none':
    case 'minimal':
      return canDisable ? 0 : normalized.includes('flash-lite') ? 512 : 128
    case 'low':
      return normalized.includes('flash') ? 1024 : 2048
    case 'high':
      return Math.min(max, 8192)
    case 'xhigh':
    case 'max':
      return max
    case 'medium':
    default:
      return -1
  }
}

function dashScopeThinkingBudgetValue(model: string, effort: ReasoningEffort): number {
  const maxBudget = dashScopeThinkingBudgetMax(model)
  if (effort === 'low') return Math.min(maxBudget, 8192)
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') return maxBudget
  return Math.min(maxBudget, 65536)
}

function siliconFlowThinkingBudgetValue(effort: ReasoningEffort): number {
  if (effort === 'low') return 1024
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') return 8192
  return 4096
}

function dashScopeThinkingBudgetMax(model: string): number {
  const normalized = model.toLowerCase().split('/').at(-1) ?? model.toLowerCase()
  if (/^qwen3\.7(?:-|$)/.test(normalized)) return 262144
  if (/^qwen3\.6-(?:flash|max-preview)(?:-|$)/.test(normalized)) return 131072
  if (/^qwen3\.6-plus(?:-|$)/.test(normalized)) return 81920
  if (/^qwen3\.5(?:-|$)/.test(normalized)) return 81920
  return 8192
}

function downgradeReasoningEffort(requested: ReasoningEffort, supported: ReasoningEffort[]): ReasoningEffort | undefined {
  if (!supported.length) return undefined
  if (requested === 'xhigh' && supported.includes('high')) return 'high'
  if (requested === 'max' && supported.includes('xhigh')) return 'xhigh'
  if (requested === 'max' && supported.includes('high')) return 'high'
  if (requested === 'minimal' && supported.includes('low')) return 'low'
  if (requested === 'none' && supported.includes('minimal')) return 'minimal'
  if (supported.includes('medium')) return 'medium'
  if (supported.includes('high')) return 'high'
  return supported[0]
}

function reasoningDisablesSampling(shape: ProviderReasoningRequestShape): boolean {
  return [
    'openai-reasoning-effort',
    'openai-responses-reasoning',
    'anthropic-output-config-effort',
    'anthropic-adaptive',
    'anthropic-budget',
    'deepseek-thinking',
    'dashscope-thinking',
    'siliconflow-thinking-budget',
    'kimi-thinking',
    'xiaomi-mimo-thinking',
  ].includes(shape)
}

function reasoningUnsupportedPayloadFields(shape: ProviderReasoningRequestShape): string[] {
  if (shape === 'xai-reasoning-effort') {
    return [
      'presence_penalty',
      'presencePenalty',
      'frequency_penalty',
      'frequencyPenalty',
      'stop',
      'stop_sequences',
      'stopSequences',
    ]
  }
  return []
}

function reasoningRequiresStatePassthrough(family: ProviderConformanceFamily, shape: ProviderReasoningRequestShape): boolean {
  return family === 'xiaomi-mimo' || family === 'anthropic' || family === 'anthropic-compatible' || [
    'deepseek-thinking',
    'kimi-thinking',
    'xai-reasoning-effort',
    'fireworks-reasoning-effort',
    'cerebras-reasoning-effort',
    'sambanova-reasoning-effort',
  ].includes(shape)
}

function reasoningStatePreservationField(
  family: ProviderConformanceFamily,
  shape: ProviderReasoningRequestShape
): ProviderCapabilityManifest['payload']['reasoningStatePreservationField'] {
  if ((family === 'anthropic' || family === 'anthropic-compatible') && shape !== 'none') return 'anthropic-content-blocks'
  if (family === 'moonshot' && shape === 'kimi-thinking') return 'thinking.keep'
  if (family === 'fireworks' && shape === 'fireworks-reasoning-effort') return 'reasoning_content'
  if (family === 'cerebras' && shape === 'cerebras-reasoning-effort') return 'reasoning'
  if (family === 'sambanova' && shape === 'sambanova-reasoning-effort') return 'reasoning'
  return undefined
}

function streamUsageField(
  family: ProviderConformanceFamily,
  protocol: ProviderConformanceProtocol
): ProviderCapabilityManifest['payload']['streamUsageField'] {
  if (family === 'dashscope' && protocol === 'openai-compatible') return 'stream_options.include_usage'
  if (family === 'ollama' && protocol === 'openai-compatible') return 'stream_options.include_usage'
  if (family === 'lm-studio' && protocol === 'openai-compatible') return 'stream_options.include_usage'
  return undefined
}

function reasoningOutputSplitField(
  input: ProviderConformanceRequest,
  family: ProviderConformanceFamily,
  protocol: ProviderConformanceProtocol
): ProviderCapabilityManifest['payload']['reasoningOutputSplitField'] {
  if (family === 'minimax' && protocol === 'openai-compatible' && isMiniMaxM3Model(input.provider, input.model)) return 'reasoning_split'
  return undefined
}

function reasoningSummaryField(
  family: ProviderConformanceFamily,
  protocol: ProviderConformanceProtocol
): ProviderCapabilityManifest['payload']['reasoningSummaryField'] {
  if (family === 'openai' && protocol === 'openai-responses') return 'reasoning.summary'
  return undefined
}

function requestedModalities(attachments: Attachment[] | undefined): string[] {
  const modalities = new Set<string>()
  for (const attachment of filterSendableAttachments(attachments)) {
    if (attachment.type === 'image') modalities.add('image')
    else modalities.add('file')
  }
  return Array.from(modalities)
}

function modalitySupported(manifest: ProviderCapabilityManifest, modality: string): boolean {
  if (modality === 'image') return manifest.modalities.input.image
  if (modality === 'file') return manifest.modalities.input.file
  return true
}

function normalizeAnthropicThinkingBudget(
  body: Record<string, unknown>,
  manifest: ProviderCapabilityManifest,
  issues: ProviderConformanceIssue[],
  adjustedParams: Record<string, unknown>
): void {
  if (manifest.reasoning.requestShape !== 'anthropic-budget') return
  const thinking = body.thinking as Record<string, unknown> | undefined
  if (!thinking || thinking.type !== 'enabled') return
  const currentBudget = numberValue(thinking.budget_tokens)
  const currentMax = numberValue(body.max_tokens) ?? manifest.context.maxOutputTokens
  const minBudget = manifest.reasoning.minBudgetTokens ?? 1024
  const budget = Math.max(minBudget, currentBudget ?? minBudget)
  const maxTokens = currentMax <= budget ? budget + 1 : currentMax
  if (budget !== currentBudget || maxTokens !== currentMax) {
    body.thinking = { ...thinking, budget_tokens: budget }
    body.max_tokens = maxTokens
    adjustedParams['thinking.budget_tokens'] = budget
    adjustedParams.max_tokens = maxTokens
    issues.push({
      code: 'thinking_budget_adjusted',
      severity: 'info',
      message: 'Anthropic manual thinking requires budget_tokens >= 1024 and below max_tokens',
      requested: { budget_tokens: currentBudget, max_tokens: currentMax },
      effective: { budget_tokens: budget, max_tokens: maxTokens },
    })
  }
}

function clampTopLevelMaxTokens(
  body: Record<string, unknown>,
  manifest: ProviderCapabilityManifest,
  issues: ProviderConformanceIssue[],
  adjustedParams: Record<string, unknown>
): void {
  for (const field of ['max_tokens', 'max_output_tokens', 'max_completion_tokens']) {
    const value = numberValue(body[field])
    if (value !== undefined && value > manifest.context.maxOutputTokens) {
      body[field] = manifest.context.maxOutputTokens
      adjustedParams[field] = manifest.context.maxOutputTokens
      issues.push({
        code: 'context_exceeded',
        severity: 'info',
        message: 'output token request was clamped to model maximum',
        field,
        requested: value,
        effective: manifest.context.maxOutputTokens,
      })
    }
  }
  const generationConfig = body.generationConfig
  if (generationConfig && typeof generationConfig === 'object' && !Array.isArray(generationConfig)) {
    const config = generationConfig as Record<string, unknown>
    const value = numberValue(config.maxOutputTokens)
    if (value !== undefined && value > manifest.context.maxOutputTokens) {
      config.maxOutputTokens = manifest.context.maxOutputTokens
      adjustedParams['generationConfig.maxOutputTokens'] = manifest.context.maxOutputTokens
      issues.push({
        code: 'context_exceeded',
        severity: 'info',
        message: 'output token request was clamped to model maximum',
        field: 'generationConfig.maxOutputTokens',
        requested: value,
        effective: manifest.context.maxOutputTokens,
      })
    }
  }
}

function supportsAnthropicAdaptiveThinkingModel(modelId: string): boolean {
  return /claude-(mythos-preview|opus-4-8|opus-4-7|opus-4-6|sonnet-4-6)/i.test(modelId)
}

function usesAnthropicOutputConfigOnlyThinkingModel(modelId: string): boolean {
  return /claude-(fable-5|mythos-5)/i.test(modelId)
}

function providerSourceUrl(family: ProviderConformanceFamily): string | undefined {
  switch (family) {
    case 'openai':
      return 'https://platform.openai.com/docs/guides/reasoning'
    case 'anthropic':
    case 'anthropic-compatible':
      return 'https://docs.anthropic.com/en/docs/about-claude/models/overview'
    case 'google':
      return 'https://ai.google.dev/gemini-api/docs/thinking'
    case 'deepseek':
      return 'https://api-docs.deepseek.com/guides/thinking_mode'
    case 'dashscope':
      return 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope'
    case 'moonshot':
      return 'https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart'
    case 'xai':
      return 'https://docs.x.ai/developers/model-capabilities/text/reasoning'
    case 'bigmodel':
      return 'https://docs.bigmodel.cn/cn/guide/models'
    case 'baidu-qianfan':
      return 'https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Fm2vrveyu'
    case 'baichuan':
      return 'https://platform.baichuan-ai.com/docs/api'
    case 'zero-one':
      return 'https://platform.lingyiwanwu.com/docs/api-reference'
    case 'stepfun':
      return 'https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create'
    case 'minimax':
      return 'https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json'
    case 'mistral':
      return 'https://docs.mistral.ai/api/#tag/chat_completion_v1_chat_completions_post'
    case 'groq':
      return 'https://console.groq.com/docs/api-reference'
    case 'together':
      return 'https://docs.together.ai/docs/openai-api-compatibility'
    case 'fireworks':
      return 'https://docs.fireworks.ai/api-reference/post-chatcompletions'
    case 'perplexity':
      return 'https://docs.perplexity.ai/api-reference/sonar-post.md'
    case 'cohere':
      return 'https://docs.cohere.com/v2/docs/compatibility-api'
    case 'cerebras':
      return 'https://inference-docs.cerebras.ai/api-reference/chat-completions.md'
    case 'sambanova':
      return 'https://sambanova-systems.mintlify.dev/docs/api-reference/chat-completions/create-chat-based-completion.md'
    case 'nvidia-nim':
      return 'https://docs.api.nvidia.com/nim/reference/llm-apis'
    case 'huggingface':
      return 'https://huggingface.co/docs/inference-providers/tasks/chat-completion.md'
    case 'github-models':
      return 'https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models'
    case 'deepinfra':
      return 'https://docs.deepinfra.com/chat/overview.md'
    case 'novita':
      return 'https://novita.ai/docs/api-reference/model-apis-llm-create-chat-completion'
    case 'siliconflow':
      return 'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions'
    case 'modelscope':
      return 'https://modelscope.cn/docs/model-service/API-Inference/intro'
    case 'tencent-hunyuan':
      return 'https://cloud.tencent.com/document/product/1729/111007'
    case 'volcengine-ark':
      return 'https://www.volcengine.com/docs/82379/1494384'
    case 'azure-openai':
      return 'https://learn.microsoft.com/azure/ai-foundry/openai/reference'
    case 'aws-bedrock':
      return 'https://docs.aws.amazon.com/bedrock/latest/userguide/openai-compatible-api.html'
    case 'vertex-ai':
      return 'https://cloud.google.com/vertex-ai/generative-ai/docs/start/openai'
    case 'ollama':
      return 'https://docs.ollama.com/api/openai-compatibility.md'
    case 'lm-studio':
      return 'https://lmstudio.ai/docs/developer/openai-compat.md'
    case 'localai':
      return 'https://localai.io/features/text-generation/'
    case 'vllm':
      return 'https://docs.vllm.ai/en/latest/serving/online_serving/'
    case 'sglang':
      return 'https://docs.sglang.io/docs/basic_usage/openai_api_completions.md'
    case 'openrouter':
      return 'https://openrouter.ai/docs/quickstart'
    case 'newapi':
      return 'https://docs.newapi.pro/zh/docs/api'
    case 'sub2api':
      return 'https://github.com/Wei-Shaw/sub2api'
    case 'xiaomi-mimo':
      return 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model'
    default:
      return undefined
  }
}

function providerSourceVerifiedAt(family: ProviderConformanceFamily): string | undefined {
  switch (family) {
    case 'openai':
    case 'anthropic':
    case 'anthropic-compatible':
    case 'google':
    case 'xai':
      return '2026-06-18'
    case 'deepseek':
    case 'dashscope':
    case 'moonshot':
    case 'bigmodel':
    case 'minimax':
    case 'mistral':
    case 'groq':
    case 'together':
    case 'fireworks':
    case 'ollama':
    case 'lm-studio':
    case 'vllm':
    case 'sglang':
    case 'openrouter':
    case 'newapi':
    case 'sub2api':
    case 'xiaomi-mimo':
      return '2026-06-10'
    case 'localai':
      return '2026-06-22'
    case 'perplexity':
      return '2026-06-21'
    case 'cohere':
      return '2026-06-21'
    case 'cerebras':
    case 'sambanova':
    case 'nvidia-nim':
    case 'huggingface':
    case 'github-models':
    case 'deepinfra':
    case 'novita':
    case 'siliconflow':
    case 'modelscope':
    case 'tencent-hunyuan':
    case 'baidu-qianfan':
    case 'baichuan':
    case 'zero-one':
    case 'stepfun':
    case 'volcengine-ark':
    case 'azure-openai':
    case 'aws-bedrock':
    case 'vertex-ai':
      return '2026-06-21'
    default:
      return undefined
  }
}

function hostedProviderFamily(family: ProviderConformanceFamily): boolean {
  return family === 'azure-openai' || family === 'aws-bedrock' || family === 'vertex-ai'
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
