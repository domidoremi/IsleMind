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
export type Language = 'zh-CN' | 'en' | 'ja'

export interface Settings {
  theme: ThemeMode
  language: Language
  defaultProvider: string | null
  fontSize: number
  hapticsEnabled: boolean
  defaultTemperature?: number
  defaultMaxTokens?: number
  memoryEnabled?: boolean
  knowledgeEnabled?: boolean
  petEnabled?: boolean
  webSearchEnabled?: boolean
  webSearchMode?: WebSearchMode
  knowledgeTopK?: number
  memoryTopK?: number
  onboardingCompleted?: boolean
  ragMode?: 'off' | 'fts' | 'hybrid'
  embeddingMode?: 'provider' | 'local' | 'hybrid'
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
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
}

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'cancelled'
export type ProcessTraceType = 'reasoning' | 'tool' | 'retrieval' | 'search' | 'memory' | 'knowledge' | 'system'
export type ProcessTraceStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'
export type ConversationProviderModelMode = 'inherited' | 'manual'
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'
export type ProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'xiaomi-mimo'
export type ProviderPresetId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'dashscope'
  | 'bigmodel'
  | 'xai'
  | 'xiaomi-mimo'
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
  topP: boolean
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
  preferredEndpoint?: 'chat-completions' | 'responses'
  source?: 'built-in' | 'remote' | 'inferred'
  deprecated?: boolean
}

export const DEFAULT_MODELS: AIModel[] = [
  model('gpt-5.5', 'GPT-5.5', 'openai', 1000000, 128000, 8192, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-5.4', 'GPT-5.4', 'openai', 1000000, 128000, 8192, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-5.4-mini', 'GPT-5.4 Mini', 'openai', 400000, 128000, 4096, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-5.4-nano', 'GPT-5.4 Nano', 'openai', 400000, 128000, 2048, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-5.2', 'GPT-5.2', 'openai', 400000, 128000, 8192, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-5.2-chat-latest', 'GPT-5.2 Chat', 'openai', 400000, 128000, 8192, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-5.2-pro', 'GPT-5.2 Pro', 'openai', 400000, 128000, 8192, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-5', 'GPT-5', 'openai', 400000, 128000, 8192, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-5-mini', 'GPT-5 Mini', 'openai', 400000, 128000, 4096, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-5-nano', 'GPT-5 Nano', 'openai', 400000, 128000, 2048, true, true, false, { preferredEndpoint: 'responses' }),
  model('gpt-4.1', 'GPT-4.1', 'openai', 1047576, 32768, 4096, true, false),
  model('gpt-4.1-mini', 'GPT-4.1 Mini', 'openai', 1047576, 32768, 4096, true, false),
  model('gpt-4.1-nano', 'GPT-4.1 Nano', 'openai', 1047576, 32768, 2048, true, false),
  model('gpt-4o', 'GPT-4o', 'openai', 128000, 16384, 4096, true, false),
  model('gpt-4o-mini', 'GPT-4o Mini', 'openai', 128000, 16384, 4096, true, false),
  model('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', 'anthropic', 200000, 64000, 8192, true, true),
  model('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 'anthropic', 200000, 64000, 8192, true, true),
  model('claude-opus-4-1-20250805', 'Claude Opus 4.1', 'anthropic', 200000, 32000, 4096, true, true),
  model('claude-opus-4-20250514', 'Claude Opus 4', 'anthropic', 200000, 32000, 4096, true, true),
  model('claude-sonnet-4-20250514', 'Claude Sonnet 4', 'anthropic', 200000, 64000, 8192, true, true),
  model('claude-3-7-sonnet-20250219', 'Claude 3.7 Sonnet', 'anthropic', 200000, 64000, 8192, true, true, true),
  model('claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 'anthropic', 200000, 8192, 4096, true, true),
  model('claude-3-5-haiku-20241022', 'Claude 3.5 Haiku', 'anthropic', 200000, 8192, 4096, true, true),
  model('claude-3-haiku-20240307', 'Claude 3 Haiku', 'anthropic', 200000, 4096, 2048, true, true, true),
  model('gemini-3-pro-preview', 'Gemini 3 Pro Preview', 'google', 1048576, 65536, 8192, true, true),
  model('gemini-3-flash-preview', 'Gemini 3 Flash Preview', 'google', 1048576, 65536, 8192, true, true),
  model('gemini-2.5-pro', 'Gemini 2.5 Pro', 'google', 1048576, 65536, 8192, true, true),
  model('gemini-2.5-flash', 'Gemini 2.5 Flash', 'google', 1048576, 65536, 8192, true, true),
  model('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'google', 1048576, 65536, 4096, true, true),
  model('deepseek-v4-pro', 'DeepSeek V4 Pro', 'openai-compatible', 1000000, 384000, 8192, false, false),
  model('deepseek-v4-flash', 'DeepSeek V4 Flash', 'openai-compatible', 1000000, 384000, 8192, false, false),
  model('deepseek-chat', 'DeepSeek Chat', 'openai-compatible', 1000000, 384000, 8192, false, false, true),
  model('deepseek-reasoner', 'DeepSeek Reasoner', 'openai-compatible', 1000000, 384000, 8192, false, false, true),
  model('mimo-v2.5-pro', 'MiMo V2.5 Pro', 'xiaomi-mimo', 1048576, 131072, 131072, false, false, false, { defaultTemperature: 1, maxTemperature: 1.5 }),
  model('mimo-v2.5', 'MiMo V2.5', 'xiaomi-mimo', 1048576, 131072, 32768, true, false, false, { defaultTemperature: 1, maxTemperature: 1.5 }),
  model('mimo-v2-pro', 'MiMo V2 Pro', 'xiaomi-mimo', 1048576, 131072, 131072, false, false, false, { defaultTemperature: 1, maxTemperature: 1.5 }),
  model('mimo-v2-omni', 'MiMo V2 Omni', 'xiaomi-mimo', 262144, 131072, 32768, true, false, false, { defaultTemperature: 1, maxTemperature: 1.5 }),
  model('mimo-v2-flash', 'MiMo V2 Flash', 'xiaomi-mimo', 262144, 65536, 65536, false, false, false, { defaultTemperature: 0.3, maxTemperature: 1.5 }),
]

export const DEFAULT_PROVIDERS: AIProvider[] = []

export function getModelName(modelId: string): string {
  return getModelConfig(modelId).name
}

export function getProviderModels(providerType: ProviderType): AIModel[] {
  return DEFAULT_MODELS.filter((model) => model.provider === providerType)
}

export function getDefaultProviderModelIds(providerType: ProviderType): string[] {
  return []
}

export function getModelConfig(modelId: string, providerType?: ProviderType, modelConfigs: AIModel[] = []): AIModel {
  const exact = modelConfigs.find((item) => item.id === modelId) ?? DEFAULT_MODELS.find((item) => item.id === modelId)
  if (exact) return { ...exact, id: modelId, provider: providerType ?? exact.provider }

  const normalized = normalizeModelId(modelId)
  const known = DEFAULT_MODELS.find((item) => item.id === normalized)
  if (known) {
    const prefix = modelId.includes('/') ? `${titleCase(modelId.split('/')[0])} / ` : ''
    return { ...known, id: modelId, name: `${prefix}${known.name}`, provider: providerType ?? known.provider }
  }

  return inferModelConfig(modelId, providerType ?? 'openai-compatible')
}

export function mergeModelConfig(modelId: string, providerType: ProviderType, remote?: Partial<AIModel>): AIModel {
  const base = getModelConfig(modelId, providerType)
  const contextWindow = remote?.contextWindow ?? base.contextWindow
  const maxOutputTokens = Math.min(remote?.maxOutputTokens ?? base.maxOutputTokens, contextWindow)
  const defaultMaxTokens = Math.min(remote?.defaultMaxTokens ?? base.defaultMaxTokens, maxOutputTokens)
  return {
    ...base,
    ...remote,
    id: modelId,
    name: remote?.name || base.name,
    provider: providerType,
    contextWindow,
    maxTokens: contextWindow,
    maxOutputTokens,
    defaultMaxTokens,
    defaultTemperature: remote?.defaultTemperature ?? base.defaultTemperature,
    maxTemperature: remote?.maxTemperature ?? base.maxTemperature,
    supportsVision: remote?.supportsVision ?? base.supportsVision,
    supportsFiles: remote?.supportsFiles ?? base.supportsFiles,
    preferredEndpoint: remote?.preferredEndpoint ?? base.preferredEndpoint,
    source: remote?.source ?? 'remote',
  }
}

export function sortModelConfigs(models: AIModel[], providerType: ProviderType): AIModel[] {
  const knownOrder = getProviderModels(providerType).map((item) => item.id)
  return [...models].sort((a, b) => {
    const aIndex = knownOrder.indexOf(normalizeModelId(a.id))
    const bIndex = knownOrder.indexOf(normalizeModelId(b.id))
    if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex
    if (aIndex >= 0) return -1
    if (bIndex >= 0) return 1
    return a.name.localeCompare(b.name)
  })
}

function model(
  id: string,
  name: string,
  provider: ProviderType,
  contextWindow: number,
  maxOutputTokens: number,
  defaultMaxTokens: number,
  supportsVision: boolean,
  supportsFiles: boolean,
  deprecated = false,
  options: Partial<AIModel> = {}
): AIModel {
  return {
    id,
    name,
    provider,
    contextWindow,
    maxTokens: contextWindow,
    maxOutputTokens,
    defaultMaxTokens,
    supportsVision,
    supportsFiles,
    source: 'built-in',
    deprecated,
    ...options,
  }
}

function normalizeModelId(modelId: string): string {
  return modelId.includes('/') ? modelId.split('/').at(-1) ?? modelId : modelId
}

function inferModelConfig(modelId: string, providerType: ProviderType): AIModel {
  const defaults = providerDefaults(providerType)
  return {
    id: modelId,
    name: titleCase(normalizeModelId(modelId).replace(/[-_]/g, ' ')),
    provider: providerType,
    contextWindow: defaults.contextWindow,
    maxTokens: defaults.contextWindow,
    maxOutputTokens: defaults.maxOutputTokens,
    defaultMaxTokens: defaults.defaultMaxTokens,
    supportsVision: defaults.supportsVision,
    supportsFiles: defaults.supportsFiles,
    preferredEndpoint: providerType === 'openai' ? 'chat-completions' : undefined,
    source: 'inferred',
  }
}

function providerDefaults(providerType: ProviderType): Pick<AIModel, 'contextWindow' | 'maxOutputTokens' | 'defaultMaxTokens' | 'supportsVision' | 'supportsFiles'> {
  switch (providerType) {
    case 'openai':
      return { contextWindow: 128000, maxOutputTokens: 16384, defaultMaxTokens: 4096, supportsVision: true, supportsFiles: false }
    case 'anthropic':
      return { contextWindow: 200000, maxOutputTokens: 8192, defaultMaxTokens: 4096, supportsVision: true, supportsFiles: true }
    case 'google':
      return { contextWindow: 1048576, maxOutputTokens: 65536, defaultMaxTokens: 8192, supportsVision: true, supportsFiles: true }
    case 'xiaomi-mimo':
      return { contextWindow: 1048576, maxOutputTokens: 131072, defaultMaxTokens: 32768, supportsVision: true, supportsFiles: false }
    case 'openai-compatible':
      return { contextWindow: 128000, maxOutputTokens: 8192, defaultMaxTokens: 4096, supportsVision: false, supportsFiles: false }
  }
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export const XIAOMI_MIMO_PAYG_BASE_URL = 'https://api.xiaomimimo.com/v1'
export const XIAOMI_MIMO_TOKEN_PLAN_BASE_URLS: Record<ProviderRegion, string> = {
  cn: 'https://token-plan-cn.xiaomimimo.com/v1',
  sgp: 'https://token-plan-sgp.xiaomimimo.com/v1',
  ams: 'https://token-plan-ams.xiaomimimo.com/v1',
}
export const XIAOMI_MIMO_TOKEN_PLAN_ANTHROPIC_BASE_URLS: Record<ProviderRegion, string> = {
  cn: 'https://token-plan-cn.xiaomimimo.com/anthropic/v1',
  sgp: 'https://token-plan-sgp.xiaomimimo.com/anthropic/v1',
  ams: 'https://token-plan-ams.xiaomimimo.com/anthropic/v1',
}

export interface ProviderConfigIssue {
  code: ChatErrorCode
  message: string
  messageKey?: string
}

export function detectProviderCredentialMode(apiKey: string): ProviderCredentialMode | null {
  const key = apiKey.trim()
  if (/^tp-[\w-]+/i.test(key)) return 'token-plan'
  if (/^sk-[\w-]+/i.test(key)) return 'payg'
  return null
}

export function getXiaomiMimoOfficialBaseUrl(
  mode: ProviderCredentialMode = 'token-plan',
  region: ProviderRegion = 'cn',
  wireProtocol: ProviderWireProtocol = 'openai-compatible'
): string {
  if (wireProtocol === 'anthropic-compatible') {
    return mode === 'token-plan' ? XIAOMI_MIMO_TOKEN_PLAN_ANTHROPIC_BASE_URLS[region] : XIAOMI_MIMO_PAYG_BASE_URL.replace(/\/v1$/, '/anthropic/v1')
  }
  return mode === 'token-plan' ? XIAOMI_MIMO_TOKEN_PLAN_BASE_URLS[region] : XIAOMI_MIMO_PAYG_BASE_URL
}

export function getProviderOfficialBaseUrl(provider: Pick<AIProvider, 'type' | 'credentialMode' | 'tokenPlanRegion' | 'wireProtocol'>): string {
  switch (provider.type) {
    case 'openai':
      return 'https://api.openai.com/v1'
    case 'anthropic':
      return 'https://api.anthropic.com/v1'
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta'
    case 'xiaomi-mimo':
      return getXiaomiMimoOfficialBaseUrl(provider.credentialMode ?? 'token-plan', provider.tokenPlanRegion ?? 'cn', provider.wireProtocol ?? 'openai-compatible')
    case 'openai-compatible':
      return 'https://api.openai.com/v1'
  }
}

export function getProviderEffectiveBaseUrl(provider: Pick<AIProvider, 'type' | 'baseUrl' | 'credentialMode' | 'tokenPlanRegion' | 'wireProtocol'>): string {
  return provider.baseUrl?.trim() || getProviderOfficialBaseUrl(provider)
}

export function getProviderConfigIssue(provider: Pick<AIProvider, 'type' | 'baseUrl' | 'credentialMode' | 'tokenPlanRegion' | 'wireProtocol'>, apiKey = ''): ProviderConfigIssue | null {
  if (provider.type !== 'xiaomi-mimo') return null
  const keyMode = detectProviderCredentialMode(apiKey)
  const selectedMode = provider.credentialMode ?? 'token-plan'
  const selectedProtocol = provider.wireProtocol ?? 'openai-compatible'
  const baseUrl = getProviderEffectiveBaseUrl(provider).toLowerCase()

  if (keyMode && keyMode !== selectedMode) {
    return {
      code: 'credential_mismatch',
      messageKey: keyMode === 'token-plan' ? 'providerIssue.mimoTpKeyWrongMode' : 'providerIssue.mimoSkKeyWrongMode',
      message: keyMode === 'token-plan' ? 'providerIssue.mimoTpKeyWrongMode' : 'providerIssue.mimoSkKeyWrongMode',
    }
  }

  if (keyMode === 'token-plan' && baseUrl.includes('api.xiaomimimo.com')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.mimoTpKeyPaygUrl',
      message: 'providerIssue.mimoTpKeyPaygUrl',
    }
  }

  if (keyMode === 'payg' && baseUrl.includes('token-plan-')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.mimoSkKeyTokenPlanUrl',
      message: 'providerIssue.mimoSkKeyTokenPlanUrl',
    }
  }

  if (selectedMode === 'token-plan' && provider.baseUrl && !baseUrl.includes('token-plan-')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.mimoTokenPlanCustomUrl',
      message: 'providerIssue.mimoTokenPlanCustomUrl',
    }
  }

  if (selectedMode === 'payg' && provider.baseUrl && baseUrl.includes('token-plan-')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.mimoPaygCustomUrl',
      message: 'providerIssue.mimoPaygCustomUrl',
    }
  }

  if (selectedProtocol === 'openai-compatible' && baseUrl.includes('/anthropic')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.openaiProtocolAnthropicUrl',
      message: 'providerIssue.openaiProtocolAnthropicUrl',
    }
  }

  if (selectedProtocol === 'anthropic-compatible' && provider.baseUrl && !baseUrl.includes('/anthropic')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.anthropicProtocolUrl',
      message: 'providerIssue.anthropicProtocolUrl',
    }
  }

  if (selectedProtocol === 'anthropic-compatible' && provider.baseUrl && baseUrl.endsWith('/anthropic')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.mimoAnthropicNeedsV1',
      message: 'providerIssue.mimoAnthropicNeedsV1',
    }
  }

  return null
}
