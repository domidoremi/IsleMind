import { getModelConfig } from '@/types'
import type { AIProvider, Attachment, ProviderType, ReasoningEffort } from '@/types'
import { getReasoningEffortOptions, isClaudeThinkingModel, isDeepSeekThinkingModel, isGeminiThinkingModel, isOpenAIReasoningModel, isXiaomiMimoReasoningModel } from '@/utils/modelReasoning'

export type ProviderConformanceFamily =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'dashscope'
  | 'moonshot'
  | 'xai'
  | 'bigmodel'
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
  | 'anthropic-adaptive'
  | 'anthropic-budget'
  | 'deepseek-thinking'
  | 'gemini-thinking-budget'
  | 'gemini-thinking-level'
  | 'xiaomi-mimo-reasoning'

export type ProviderConformanceIssueCode =
  | 'unsupported_modality'
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
    requiresReasoningStatePassthrough: boolean
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
  const sourceUrl = modelConfig.sourceUrl ?? providerSourceUrl(family)
  const sourceConfidence = sourceUrl ? 'source-backed' : 'inferred'

  return {
    id: `${family}:${input.model}`,
    family,
    protocol,
    providerType: provider.type,
    model: input.model,
    context: {
      windowTokens: modelConfig.contextWindow,
      maxOutputTokens: modelConfig.maxOutputTokens,
    },
    modalities: {
      input: {
        text: true,
        image: modelConfig.supportsVision || provider.capabilities?.vision === true,
        file: modelConfig.supportsFiles || provider.capabilities?.files === true,
        audio: provider.capabilities?.audioInput === true,
        video: false,
      },
      output: {
        text: true,
        speech: provider.capabilities?.speech === true,
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
      requiresReasoningStatePassthrough: family === 'xiaomi-mimo',
    },
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

  if (reasoning.enabled && manifest.reasoning.disablesSamplingWhenEnabled) {
    for (const field of manifest.payload.samplingFields) {
      if (field in next) {
        delete next[field]
        removedParams.push(field)
      }
    }
  }

  normalizeAnthropicThinkingBudget(next, manifest, issues, adjustedParams)
  clampTopLevelMaxTokens(next, manifest, issues, adjustedParams)

  if (removedParams.length) {
    issues.push({
      code: 'param_conflict_removed',
      severity: 'info',
      message: 'provider conformance removed sampling parameters that conflict with active reasoning',
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
  if (provider.type === 'openai') return 'openai'
  if (provider.type === 'anthropic') return 'anthropic'
  if (provider.type === 'google') return 'google'
  if (provider.type === 'xiaomi-mimo') return 'xiaomi-mimo'
  if (provider.wireProtocol === 'anthropic-compatible') return 'anthropic-compatible'
  if (provider.presetId === 'deepseek' || provider.detectedPresetId === 'deepseek' || (provider.baseUrl ?? '').toLowerCase().includes('deepseek')) return 'deepseek'
  if (matchesProviderFamily(provider, 'dashscope', /qwen|qwq|qvq|dashscope|tongyi|aliyun|alibaba|百炼|阿里/i)) return 'dashscope'
  if (matchesProviderFamily(provider, undefined, /kimi|moonshot/i)) return 'moonshot'
  if (matchesProviderFamily(provider, 'xai', /grok|(^|[-_./])xai($|[-_./])|api\.x\.ai/i)) return 'xai'
  if (matchesProviderFamily(provider, 'bigmodel', /glm|bigmodel|zhipu|智谱/i)) return 'bigmodel'
  if (matchesProviderFamily(provider, 'openrouter', /openrouter/i)) return 'openrouter'
  if (matchesProviderFamily(provider, 'newapi', /newapi|new-api|oneapi|one-api/i)) return 'newapi'
  if (matchesProviderFamily(provider, 'sub2api', /sub2api/i)) return 'sub2api'
  return 'openai-compatible'
}

function matchesProviderFamily(provider: AIProvider, presetId: string | undefined, pattern: RegExp): boolean {
  if (presetId && (provider.presetId === presetId || provider.detectedPresetId === presetId)) return true
  const text = [provider.id, provider.name, provider.baseUrl, provider.models?.join(' ')].filter(Boolean).join(' ')
  return pattern.test(text)
}

function inferProtocol(input: ProviderConformanceRequest, family: ProviderConformanceFamily): ProviderConformanceProtocol {
  if (family === 'openai') {
    const config = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
    return config.preferredEndpoint === 'responses' || input.webSearchMode === 'native' ? 'openai-responses' : 'openai-chat-completions'
  }
  if (family === 'anthropic') return 'anthropic-messages'
  if (family === 'google') return 'google-generate-content'
  if (family === 'deepseek') return 'openai-compatible'
  if (['dashscope', 'moonshot', 'xai', 'bigmodel', 'openrouter', 'newapi', 'sub2api'].includes(family)) return 'openai-compatible'
  if (family === 'xiaomi-mimo') return input.provider.wireProtocol === 'anthropic-compatible' ? 'xiaomi-mimo-anthropic-compatible' : 'xiaomi-mimo-openai-compatible'
  if (family === 'anthropic-compatible') return 'anthropic-compatible'
  return 'openai-compatible'
}

function inferReasoningRequestShape(input: ProviderConformanceRequest, family: ProviderConformanceFamily, protocol: ProviderConformanceProtocol): ProviderReasoningRequestShape {
  const config = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
  if (family === 'openai' && isOpenAIReasoningModel(input.provider, input.model)) {
    return protocol === 'openai-responses' ? 'openai-responses-reasoning' : 'openai-reasoning-effort'
  }
  if (family === 'anthropic' || family === 'anthropic-compatible') {
    if (config.reasoningMode === 'anthropic-thinking' || isClaudeThinkingModel(input.provider, input.model)) {
      return supportsAnthropicAdaptiveThinkingModel(input.model) ? 'anthropic-adaptive' : 'anthropic-budget'
    }
  }
  if (family === 'google' && isGeminiThinkingModel(input.provider, input.model)) {
    return /^gemini-3/i.test(input.model) || config.reasoningMode === 'gemini-thinking-level' ? 'gemini-thinking-level' : 'gemini-thinking-budget'
  }
  if (family === 'deepseek' && (config.reasoningMode === 'deepseek-thinking' || isDeepSeekThinkingModel(input.provider, input.model))) return 'deepseek-thinking'
  if (family === 'xiaomi-mimo' && isXiaomiMimoReasoningModel(input.provider, input.model)) return 'xiaomi-mimo-reasoning'
  return 'none'
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
  if (family === 'openai') {
    return 'max_completion_tokens'
  }
  return 'max_tokens'
}

function resolveReasoning(input: ProviderConformanceRequest, manifest: ProviderCapabilityManifest, issues: ProviderConformanceIssue[]): ProviderReasoningResolution {
  const requested = input.reasoningEffort
  if (!requested || !manifest.reasoning.supported || OFF_EFFORTS.has(requested)) {
    return { requested, enabled: false, requestShape: manifest.reasoning.requestShape }
  }
  const supported = manifest.reasoning.selectableEfforts
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
  return {
    requested,
    enabled: true,
    effective,
    providerValue: providerReasoningValue(manifest.reasoning.requestShape, effective, manifest.model),
    requestShape: manifest.reasoning.requestShape,
    downgradeReason: effective !== requested ? 'unsupported_effort' : undefined,
  }
}

function providerReasoningValue(shape: ProviderReasoningRequestShape, effort: ReasoningEffort | undefined, model: string): string | number | boolean | undefined {
  if (!effort) return undefined
  if (shape === 'deepseek-thinking') return effort === 'xhigh' ? 'max' : 'high'
  if (shape === 'xiaomi-mimo-reasoning') {
    if (effort === 'low' || effort === 'minimal') return 'low'
    if (effort === 'high' || effort === 'xhigh') return 'high'
    return 'medium'
  }
  if (shape === 'anthropic-adaptive') {
    if (effort === 'xhigh') return /claude-opus-4-7/i.test(model) ? 'xhigh' : 'max'
    return effort
  }
  if (shape === 'anthropic-budget') {
    if (effort === 'low') return 1024
    if (effort === 'high') return 4096
    if (effort === 'xhigh') return 8192
    return 2048
  }
  if (shape === 'gemini-thinking-budget') {
    if (effort === 'low') return 1024
    if (effort === 'medium') return 4096
    if (effort === 'high') return 8192
    if (effort === 'xhigh') return 16384
    return effort === 'minimal' || effort === 'none' ? 0 : 4096
  }
  return effort
}

function downgradeReasoningEffort(requested: ReasoningEffort, supported: ReasoningEffort[]): ReasoningEffort | undefined {
  if (!supported.length) return undefined
  if (requested === 'xhigh' && supported.includes('high')) return 'high'
  if (requested === 'minimal' && supported.includes('low')) return 'low'
  if (requested === 'none' && supported.includes('minimal')) return 'minimal'
  if (supported.includes('medium')) return 'medium'
  return supported[0]
}

function reasoningDisablesSampling(shape: ProviderReasoningRequestShape): boolean {
  return [
    'openai-reasoning-effort',
    'openai-responses-reasoning',
    'anthropic-adaptive',
    'anthropic-budget',
    'deepseek-thinking',
  ].includes(shape)
}

function requestedModalities(attachments: Attachment[] | undefined): string[] {
  const modalities = new Set<string>()
  for (const attachment of attachments ?? []) {
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
}

function supportsAnthropicAdaptiveThinkingModel(modelId: string): boolean {
  return /claude-(mythos|opus-4-7|opus-4-6|sonnet-4-6)/i.test(modelId)
}

function providerSourceUrl(family: ProviderConformanceFamily): string | undefined {
  switch (family) {
    case 'openai':
      return 'https://platform.openai.com/docs/guides/reasoning'
    case 'anthropic':
    case 'anthropic-compatible':
      return 'https://platform.claude.com/docs/en/build-with-claude/effort'
    case 'google':
      return 'https://ai.google.dev/gemini-api/docs/thinking'
    case 'deepseek':
      return 'https://api-docs.deepseek.com/guides/thinking_mode'
    case 'dashscope':
      return 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope'
    case 'moonshot':
      return 'https://platform.moonshot.cn/docs'
    case 'xai':
      return 'https://docs.x.ai/docs/api-reference'
    case 'bigmodel':
      return 'https://docs.bigmodel.cn/cn/guide/models'
    case 'openrouter':
      return 'https://openrouter.ai/docs/quickstart'
    case 'newapi':
      return 'https://docs.newapi.pro/zh/docs/api'
    case 'sub2api':
      return 'https://github.com/sub2api/sub2api'
    case 'xiaomi-mimo':
      return 'https://platform.xiaomimimo.com/docs/en-US/welcome'
    default:
      return undefined
  }
}

function providerSourceVerifiedAt(family: ProviderConformanceFamily): string | undefined {
  return providerSourceUrl(family) ? '2026-06-01' : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
