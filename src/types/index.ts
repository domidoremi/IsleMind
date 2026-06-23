export interface Attachment {
  id: string
  type: AttachmentType
  uri: string
  name: string
  mimeType: string
  size: number
  base64?: string
}

export interface ProcessTrace {
  id: string
  type: ProcessTraceType
  title: string
  content?: string
  status: ProcessTraceStatus
  startedAt?: number
  completedAt?: number
  durationMs?: number
  metadata?: Record<string, unknown>
}

export interface ToolContentBlock {
  type: 'text' | 'image' | 'resource'
  text?: string
  mimeType?: string
  uri?: string
  data?: string
  name?: string
}

export interface CommandReference {
  id: string
  type: 'skill' | 'provider' | 'model' | 'knowledge' | 'memory'
  label: string
  value: string
  metadata?: Record<string, unknown>
}

export type SkillLayer = 'base' | 'advanced' | 'adaptive'
export type SkillVariableType = 'text' | 'number' | 'boolean' | 'choice'
export type SkillStackPolicy = 'append' | 'override'

export interface SkillVariable {
  name: string
  label?: string
  type: SkillVariableType
  required?: boolean
  defaultValue?: string | number | boolean
  options?: string[]
}

export interface SkillDefinition {
  schema: 'islemind.skill.v1'
  id: string
  name: string
  layer: SkillLayer
  version?: string
  description?: string
  tags: string[]
  priority: number
  systemPrompt: string
  variables?: SkillVariable[]
  model?: string
  providerId?: string
  temperature?: number
  maxTokens?: number
  enabledTools?: string[]
  knowledgeSources?: string[]
  firstUserMessage?: string
  expectedReplyFormat?: string
  stackPolicy?: SkillStackPolicy
  createdAt: number
  updatedAt: number
}

export interface SkillSnapshot {
  skillIds: string[]
  names: string[]
  systemPrompt: string
  variables: Record<string, string | number | boolean>
  enabledTools?: string[]
  knowledgeSources?: string[]
  model?: string
  providerId?: string
  temperature?: number
  maxTokens?: number
  firstUserMessage?: string
  expectedReplyFormat?: string
}

export type McpTransport = 'sse' | 'websocket'
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type McpToolPermission = 'read-only' | 'read-write' | 'destructive'

export interface McpToolManifest {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  permission: McpToolPermission
  serverId: string
  enabled: boolean
}

export interface McpResourceManifest {
  uri: string
  name?: string
  description?: string
  mimeType?: string
  serverId: string
}

export interface McpPromptManifest {
  name: string
  description?: string
  arguments?: Record<string, unknown>[]
  serverId: string
}

export interface McpServerConfig {
  id: string
  name: string
  url: string
  transport: McpTransport
  enabled: boolean
  status: McpConnectionStatus
  version?: string
  manifestTtlMs: number
  manifestCachedAt?: number
  tools: McpToolManifest[]
  resources: McpResourceManifest[]
  prompts: McpPromptManifest[]
  approvedToolNames: string[]
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  responseText?: string
  reasoning?: ProcessTrace[]
  toolCalls?: ProcessTrace[]
  retrievalTrace?: ProcessTrace[]
  attachments?: Attachment[]
  citations?: MessageCitation[]
  timestamp: number
  status: MessageStatus
  tokenCount?: number
  usage?: MessageUsage
  durationMs?: number
  startedAt?: number
  completedAt?: number
  estimatedTokens?: boolean
  errorCode?: ChatErrorCode
  errorProviderId?: string
}

export interface MessageUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  source: 'provider' | 'estimated'
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
}

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

export interface Conversation {
  id: string
  title: string
  providerId: string
  model: string
  providerModelMode?: ConversationProviderModelMode
  skillIds?: string[]
  skillSnapshot?: SkillSnapshot
  enabledTools?: string[]
  knowledgeSources?: string[]
  commandRefs?: CommandReference[]
  systemPrompt: string
  temperature: number
  topP?: number
  reasoningEffort?: ReasoningEffort
  maxTokens: number
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export type ThemeMode = 'light' | 'dark' | 'system'
export type ThemeId = 'minimal' | 'glass' | 'cartoon'
export type Language = 'zh-CN' | 'en' | 'ja'
export type OnboardingCompanionMode = 'concise' | 'research' | 'creative' | 'engineering' | 'companion'
export type UpstreamTransportMode = 'auto' | 'http' | 'websocket'
export type RemoteCompactMode = 'off' | 'auto' | 'required'
export type PayloadPolicyMode = 'off' | 'warn' | 'block'
export type ProxyMode = 'off' | 'custom-base-url' | 'system-detected'
export type BedrockCacheTtl = 'default' | '5m' | '1h'

export interface Settings {
  theme: ThemeMode
  themeId?: ThemeId
  language: Language
  defaultProvider: string | null
  fontSize: number
  hapticsEnabled: boolean
  systemStatusNotificationsEnabled?: boolean
  defaultTemperature?: number
  defaultMaxTokens?: number
  memoryEnabled?: boolean
  knowledgeEnabled?: boolean
  webSearchEnabled?: boolean
  webSearchMode?: WebSearchMode
  knowledgeTopK?: number
  memoryTopK?: number
  onboardingCompleted?: boolean
  onboardingCompanionMode?: OnboardingCompanionMode
  ragMode?: 'off' | 'fts' | 'hybrid'
  embeddingMode?: 'provider' | 'local' | 'hybrid'
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  localModelDownloadMirrorBaseUrl?: string
  ragProfile?: RagProfile
  ragQueryRewriteEnabled?: boolean
  ragHydeEnabled?: boolean
  ragFlareEnabled?: boolean
  ragGraphEnabled?: boolean
  ragRaptorEnabled?: boolean
  ragCrossEncoderEnabled?: boolean
  ragColbertEnabled?: boolean
  ragLlmlinguaEnabled?: boolean
  searchProvider?: SearchProviderId
  googleSearchCx?: string
  customSearchEndpoint?: string
  autoUpdateCheckEnabled?: boolean
  lastApkUpdateCheckAt?: number
  providerCatalogVersion?: number
  skillsEnabled?: boolean
  mcpEnabled?: boolean
  commandPaletteEnabled?: boolean
  agentWorkflowMaxSteps?: number
  agentWorkflowMaxToolCallsPerStep?: number
  agentWorkflowAllowReadOnlyTools?: boolean
  agentWorkflowAllowReadWriteTools?: boolean | 'visible'
  agentWorkflowAllowDestructiveTools?: boolean | 'confirm'
  agentWorkflowOutputCharLimit?: number
  transportMode?: UpstreamTransportMode
  remoteCompactMode?: RemoteCompactMode
  remoteCompactThreshold?: number
  remoteCompactThresholdTokens?: number
  payloadPolicyMode?: PayloadPolicyMode
  proxyMode?: ProxyMode
  proxyBaseUrl?: string
  providerAllowlist?: string[]
  providerBlocklist?: string[]
  modelAllowlist?: string[]
  modelBlocklist?: string[]
  runtimeLogEnabled?: boolean
  runtimeLogMaxBytes?: number
  sessionConcurrencyLimit?: number
  sessionQueueTimeoutMs?: number
  upstreamRequestTimeoutMs?: number
  upstreamMaxRetries?: number
  upstreamCircuitBreakerEnabled?: boolean
  upstreamCircuitBreakerFailureThreshold?: number
  upstreamCircuitBreakerCooldownMs?: number
  requestRectificationEnabled?: boolean
  anthropicThinkingSignatureRectificationEnabled?: boolean
  anthropicThinkingBudgetRectificationEnabled?: boolean
  bedrockRequestOptimizerEnabled?: boolean
  thinkingOptimizerEnabled?: boolean
  cacheInjectionEnabled?: boolean
  cacheTtl?: BedrockCacheTtl
  modelTestModel?: string
  modelTestCheckParameters?: boolean
}

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'cancelled'
export type ProcessTraceType = 'reasoning' | 'tool' | 'retrieval' | 'search' | 'memory' | 'knowledge' | 'system'
export type ProcessTraceStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'
export type ConversationProviderModelMode = 'inherited' | 'manual'
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ModelReasoningMode = 'openai-effort' | 'gemini-thinking-level' | 'gemini-thinking-budget' | 'deepseek-thinking' | 'anthropic-thinking' | 'dashscope-thinking' | 'kimi-thinking' | 'minimax-thinking' | 'xai-reasoning-effort' | 'groq-reasoning-effort' | 'together-reasoning-effort' | 'fireworks-reasoning-effort' | 'perplexity-reasoning-effort' | 'cohere-reasoning-effort' | 'cerebras-reasoning-effort' | 'sambanova-reasoning-effort' | 'huggingface-reasoning-effort' | 'deepinfra-reasoning-effort' | 'siliconflow-thinking-budget' | 'none'
export type ProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'xiaomi-mimo'
export type ProviderPresetId =
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
  | 'custom-openai-compatible'
  | 'custom-anthropic-compatible'
export type ProviderDetectionStatus = 'idle' | 'detected' | 'manual' | 'testing' | 'failed'
export type ProviderTestStatus = 'idle' | 'ok' | 'bad'
export type ProviderCredentialMode = 'payg' | 'token-plan'
export type ProviderRegion = 'cn' | 'sgp' | 'ams'
export type ProviderWireProtocol = 'openai-compatible' | 'anthropic-compatible'
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
export type AttachmentType = 'image' | 'pdf' | 'text' | 'document'
export type WebSearchMode = 'native' | 'tavily' | 'off'
export type SearchProviderId = 'native' | 'tavily' | 'google' | 'bing' | 'custom' | 'off'
export type MemoryStatus = 'pending' | 'active' | 'disabled'
export type MemorySourceKind = 'manual' | 'deterministic' | 'model' | 'imported' | 'legacy'
export type RetrievalSourceType = 'memory' | 'knowledge' | 'web'
export type RagProfile = 'fast' | 'balanced' | 'deep' | 'offline'
export type RagQueryComplexity = 'simple' | 'focused' | 'complex'
export type RagQueryIntent = 'fact' | 'how-to' | 'analysis' | 'comparison' | 'debug' | 'creative'
export type RagRiskLevel = 'low' | 'medium' | 'high'
export type RagTechnique =
  | 'hybrid-search'
  | 'query-rewriting'
  | 'hyde'
  | 'cross-encoder'
  | 'lost-in-middle'
  | 'citation-injection'
  | 'llmlingua'
  | 'colbert'
  | 'graphrag'
  | 'raptor'
  | 'flare'
export type RagRetrievalOrigin = RetrievalSourceType | 'query-rewrite' | 'hyde' | 'raptor' | 'graph' | 'colbert'
export type LocalRagModelCapability = 'embedding' | 'reranker' | 'colbert' | 'compressor'

export interface RagQueryPlan {
  id: string
  profile: RagProfile
  profileSource: 'settings' | 'tool-request' | 'rag-mode'
  profileReason?: string
  query: string
  language: Language | 'mixed'
  intent: RagQueryIntent
  complexity: RagQueryComplexity
  risk: RagRiskLevel
  rewrittenQueries: string[]
  hydePrompt?: string
  subQueries: string[]
  enabledTechniques: RagTechnique[]
  retrievalBudget: number
  contextItemBudget: number
  tokenBudget: number
  createdAt: number
}

export interface RagRetrievalCandidate extends RetrievalSource {
  candidateId: string
  origin: RagRetrievalOrigin
  queryVariant?: string
  originalRank?: number
  originalScore?: number
  rerankScore?: number
  compressionRatio?: number
  sourceReason?: string
  headingPath?: string[]
  semanticBoundary?: string
  qualityScore?: number
}

export interface RagRerankResult {
  before: RagRetrievalCandidate[]
  after: RagRetrievalCandidate[]
  strategy: 'local-statistical' | 'cross-encoder-fallback' | 'cross-encoder-local' | 'colbert-lite' | 'colbert-local'
  usedModel?: string
  fallbackReasons?: string[]
}

export interface RagCitation extends MessageCitation {
  label: string
  rerankScore?: number
  compressionRatio?: number
  sourceReason?: string
}

export interface RagContextPack {
  plan: RagQueryPlan
  sources: RagRetrievalCandidate[]
  citations: RagCitation[]
  contextPrompt: string
  trace: RagTraceStep[]
  quality: RagEvaluationResult
  retrievalStats?: RagRetrievalStats
}

export interface RagTraceStep {
  id: string
  stage: 'plan' | 'retrieve' | 'rerank' | 'pack' | 'generate' | 'verify' | 'flare' | 'evaluate'
  title: string
  status: ProcessTraceStatus
  content?: string
  startedAt: number
  completedAt?: number
  durationMs?: number
  metadata?: Record<string, unknown>
}

export interface RagEvaluationResult {
  sourceCount: number
  candidateCount?: number
  citationCoverage: number
  contextPrecision: number
  compressionRatio: number
  confidence: number
  activeRetrievals: number
  missingEvidence: boolean
  warnings: string[]
  generationConfidence?: number
  factualClaimCount?: number
  citedClaimCount?: number
  unsupportedClaimCount?: number
  flareTriggered?: boolean
  fallbackReasons?: string[]
  latencyMs?: number
  tokenBudget?: number
  estimatedContextTokens?: number
}

export interface RagRetrievalStats {
  queryVariants: number
  memoryCandidates: number
  knowledgeCandidates: number
  advancedCandidates: number
  byOrigin: Partial<Record<RagRetrievalOrigin, number>>
}

export interface RagEvaluationLog {
  id: string
  query: string
  plan?: RagQueryPlan
  quality?: RagEvaluationResult
  sourceCount: number
  latencyMs?: number
  createdAt: number
}

export interface RagIndexingJobStatus {
  id: string
  documentId?: string
  kind: string
  status: string
  progress?: number
  error?: string
  createdAt: number
  updatedAt: number
}

export interface RagGenerationVerification {
  confidence: number
  factualClaimCount: number
  citedClaimCount: number
  unsupportedClaimCount: number
  needsFlare: boolean
  reasons: string[]
  followupQuery?: string
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
  strategy: 'sequential-low-rate'
}

export interface MessageCitation {
  id: string
  type: RetrievalSourceType
  title: string
  excerpt?: string
  url?: string
  documentId?: string
  chunkId?: string
  score?: number
  ftsScore?: number
  vectorScore?: number
  chunkIndex?: number
  similarityScore?: number
  sourceUri?: string
  retrievalMode?: 'fts' | 'vector' | 'hybrid'
  rerankScore?: number
  compressionRatio?: number
  sourceReason?: string
  headingPath?: string[]
  semanticBoundary?: string
  qualityScore?: number
  queryVariant?: string
  retrievalStage?: string
}

export interface RetrievalSource extends MessageCitation {
  content: string
}

export interface MemoryItem {
  id: string
  content: string
  status: MemoryStatus
  conversationId?: string
  sourceKind?: MemorySourceKind
  sourceDetail?: string
  confidence?: number
  score?: number
  lastHitAt?: number
  createdAt: number
  updatedAt: number
}

export interface KnowledgeDocument {
  id: string
  title: string
  mimeType: string
  size: number
  chunkCount: number
  status: 'ready' | 'extracting' | 'error'
  error?: string
  sourceUri?: string
  rawPath?: string
  contentHash?: string
  createdAt: number
  updatedAt: number
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  title: string
  content: string
  ordinal: number
  chunkIndex?: number
  sentenceStart?: number
  sentenceEnd?: number
  semanticBoundary?: string
  headingPath?: string[]
  entities?: string[]
  relations?: string[]
  summaryNodeId?: string
  parentChunkId?: string
  qualityScore?: number
  embeddingModelId?: string
  rerankSignals?: Record<string, number>
  embeddingProvider?: 'hash' | 'provider' | 'onnx'
  lastHitAt?: number
  score?: number
  ftsScore?: number
  vectorScore?: number
  retrievalMode?: 'fts' | 'vector' | 'hybrid'
  createdAt: number
}

export interface SearchProviderSettings {
  tavilyConfigured: boolean
}

export interface AIModel {
  id: string
  name: string
  provider: ProviderType
  contextWindow: number
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

export const DEFAULT_PROVIDERS: AIProvider[] = []
export {
  DEFAULT_MODELS,
  getDefaultProviderModelIds,
  getModelConfig,
  getModelName,
  getProviderModels,
  mergeModelConfig,
  sortModelConfigs,
} from './modelCatalog'
export {
  XIAOMI_MIMO_PAYG_BASE_URL,
  XIAOMI_MIMO_TOKEN_PLAN_ANTHROPIC_BASE_URLS,
  XIAOMI_MIMO_TOKEN_PLAN_BASE_URLS,
  detectProviderCredentialMode,
  getProviderConfigIssue,
  getProviderEffectiveBaseUrl,
  getProviderOfficialBaseUrl,
  getXiaomiMimoOfficialBaseUrl,
  hasCustomProviderBaseUrl,
  isHttpProviderBaseUrl,
  sanitizeProviderBaseUrl,
  type ProviderConfigIssue,
} from './providerBaseUrls'
