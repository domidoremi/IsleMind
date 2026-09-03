import type { ReasoningEffort } from '@/core'

export type ModelReasoningMode = 'openai-effort' | 'gemini-thinking-level' | 'gemini-thinking-budget' | 'deepseek-thinking' | 'anthropic-thinking' | 'dashscope-thinking' | 'kimi-thinking' | 'minimax-thinking' | 'xai-reasoning-effort' | 'groq-reasoning-effort' | 'together-reasoning-effort' | 'fireworks-reasoning-effort' | 'perplexity-reasoning-effort' | 'cohere-reasoning-effort' | 'cerebras-reasoning-effort' | 'sambanova-reasoning-effort' | 'huggingface-reasoning-effort' | 'deepinfra-reasoning-effort' | 'siliconflow-thinking-budget' | 'none'
export type ProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'xiaomi-mimo'
export type ProviderPresetId =
  | 'custom-endpoint'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'dashscope'
  | 'moonshot'
  | 'bigmodel'
  | 'minimax'
  | 'xai'
  | 'xiaomi-mimo'
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
  | 'volcengine-ark'
  | 'baidu-qianfan'
  | 'tencent-hunyuan'
  | 'baichuan'
  | 'stepfun'
  | 'zero-one'
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
export type ProviderDetectionStatus = 'idle' | 'detected' | 'manual' | 'testing' | 'failed'
export type ProviderTestStatus = 'idle' | 'ok' | 'bad'
export type ProviderCredentialMode = 'payg' | 'token-plan'
export type ProviderRegion = 'cn' | 'sgp' | 'ams'
export type ProviderWireProtocol = 'openai-compatible' | 'anthropic-compatible'

export type ProviderClientSimulationProfileId =
  | 'islemind'
  | 'codex-cli'
  | 'codex-desktop'
  | 'claude-code'
  | 'claude-code-desktop'
  | 'grok-build'
  | 'openai-api'
  | 'anthropic-api'
  | 'deepseek-api'
  | 'glm-api'

export type ProviderClientCompatibilityMode = 'auto' | ProviderClientSimulationProfileId
export type ChatErrorCode =
  | 'missing_key'
  | 'disabled_provider'
  | 'credential_mismatch'
  | 'bad_auth'
  | 'bad_base_url'
  | 'model_unavailable'
  | 'network_error'
  | 'timeout'
  | 'rate_limited'
  | 'max_tokens_exceeded'
  | 'provider_conformance_blocked'
  | 'unknown'
export type ProviderOperationCode =
  | 'ok'
  | 'missing_key'
  | 'credential_mismatch'
  | 'bad_auth'
  | 'bad_base_url'
  | 'model_unavailable'
  | 'models_endpoint_unavailable'
  | 'network_error'
  | 'timeout'
  | 'rate_limited'
  | 'max_tokens_exceeded'
  | 'empty_models'
  | 'unknown'

export type ProviderModelTestCapabilityCheckStatus = 'sent' | 'available' | 'blocked'

export interface ProviderModelTestCapabilityCheck {
  capability:
    | 'chat'
    | 'streaming'
    | 'tools'
    | 'vision'
    | 'files'
    | 'reasoning'
    | 'responseFormat'
    | 'responsesApi'
    | 'nativeSearch'
  status: ProviderModelTestCapabilityCheckStatus
  sent: boolean
  canSend: boolean
  evidence?: {
    status: 'verified' | 'inferred' | 'manual' | 'unsupported'
    source: string
    reason: string
  }
}

export interface ProviderCredentialGroup {
  id: string
  label: string
  apiKey?: string
  enabled: boolean
  availableModels?: string[]
  lastModelSyncAt?: number
  lastModelSyncStatus?: ProviderTestStatus
  lastModelSyncMessage?: string
  lastModelSyncCode?: ProviderOperationCode
  lastUsedAt?: number
  lastFailureAt?: number
  failureCount?: number
}

export interface ProviderCapabilities {
  chat: boolean
  streaming: boolean
  modelList: boolean
  vision: boolean
  files: boolean
  audioInput: boolean
  audioTranscription: boolean
  speech: boolean
  nativeSearch: boolean
  reasoningEffort: boolean
  nativeTools?: boolean
  topP: boolean
  embeddings?: boolean
  rerank?: boolean
  responsesApi?: boolean
  responsesWebSocket?: boolean
  remoteCompact?: boolean
  payloadPolicy?: boolean
}

export interface ModelAlias {
  alias: string
  model: string
}

export interface ProviderModelAvailability {
  modelId: string
  credentialGroupIds: string[]
  lastSyncedAt?: number
}

export interface ProviderSyncPolicy {
  minDelayMs: number
  maxDelayMs: number
  timeoutMs: number
  strategy: 'sequential-low-rate' | 'parallel-balanced'
  concurrency?: number
}

export interface AIModel {
  id: string
  name: string
  provider: ProviderType
  contextWindow: number
  /** Legacy alias for contextWindow; retained by provider-intelligence contract tests. */
  maxTokens: number
  maxOutputTokens: number
  defaultMaxTokens: number
  defaultTemperature?: number
  maxTemperature?: number
  supportsVision: boolean
  supportsFiles: boolean
  supportsTools?: boolean
  supportedParameters?: string[]
  supportsStreaming?: boolean
  preferredEndpoint?: 'chat-completions' | 'responses'
  reasoningMode?: ModelReasoningMode
  reasoningEfforts?: ReasoningEffort[]
  sourceUrl?: string
  verifiedAt?: string
  deprecatedReason?: string
  source?: 'built-in' | 'remote' | 'inferred'
  deprecated?: boolean
  chatCompatible?: boolean
}

export interface AIProvider {
  id: string
  type: ProviderType
  presetId?: ProviderPresetId
  detectedPresetId?: ProviderPresetId
  detectionStatus?: ProviderDetectionStatus
  name: string
  apiKey: string
  baseUrl?: string
  credentialMode?: ProviderCredentialMode
  tokenPlanRegion?: ProviderRegion
  wireProtocol?: ProviderWireProtocol
  clientCompatibilityProfile?: ProviderClientCompatibilityMode
  credentialGroups?: ProviderCredentialGroup[]
  capabilities?: ProviderCapabilities
  modelAvailability?: ProviderModelAvailability[]
  syncPolicy?: ProviderSyncPolicy
  models: string[]
  manualModels?: string[]
  modelAliases?: ModelAlias[]
  modelConfigs?: AIModel[]
  enabled: boolean
  lastModelSyncAt?: number
  lastModelSyncStatus?: ProviderTestStatus
  lastModelSyncMessage?: string
  lastModelSyncCode?: ProviderOperationCode
  lastTestStatus?: ProviderTestStatus
  lastTestedAt?: number
  lastTestModel?: string
  lastTestMessage?: string
  lastTestCode?: ProviderOperationCode
  lastModelTestCapabilityChecks?: ProviderModelTestCapabilityCheck[]
  /** Provider-owned persisted data. Validate through the Providers module before use. */
  usageQueryConfiguration?: unknown
}
