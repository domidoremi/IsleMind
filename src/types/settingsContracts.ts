export type ThemeMode = 'light' | 'dark' | 'system'
/** Canonical product theme families. Legacy values remain input-only aliases. */
export type CanonicalThemeId = 'minimal' | 'monet' | 'material' | 'liquid-glass'
export type LegacyThemeId = 'lime-road' | 'markdown' | 'cartoon' | 'island' | 'glass' | 'material-3' | 'material3' | 'liquid'
export type ThemeId = CanonicalThemeId | LegacyThemeId
export type Language = 'zh-CN' | 'en' | 'ja'
export type UpstreamTransportMode = 'auto' | 'http' | 'websocket'
export type RemoteCompactMode = 'off' | 'auto' | 'required'
export type PayloadPolicyMode = 'off' | 'warn' | 'block'
export type ProxyMode = 'off' | 'custom-base-url' | 'system-detected'
export type ObservabilitySinkMode = 'off' | 'local-only' | 'external'
export type ObservabilitySinkTarget = 'opentelemetry' | 'langfuse' | 'phoenix'
export type ObservabilitySinkHighFrequencyExportMode = 'drop' | 'coalesced' | 'per-event'
export type BedrockCacheTtl = 'default' | '5m' | '1h'
export type WebSearchMode = 'native' | 'tavily' | 'off'
export type SearchProviderId = 'islemind' | 'native' | 'tavily' | 'google' | 'bing' | 'custom' | 'off'
export type RagProfile = 'fast' | 'balanced' | 'deep' | 'offline'

export interface SettingsModelDisplayAlias {
  providerId: string
  modelId: string
  displayName: string
}

export interface Settings {
  theme: ThemeMode
  themeId?: ThemeId
  themeAccent?: string
  assistantDisplayName?: string
  modelDisplayAliases?: SettingsModelDisplayAlias[]
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
  /**
   * Opt-in to summarizing older turns with the conversation's own model when the
   * provider exposes no native compaction. Costs one extra non-streaming request
   * per compaction, so it stays off until the user enables it.
   */
  modelContextCompressionEnabled?: boolean
  payloadPolicyMode?: PayloadPolicyMode
  proxyMode?: ProxyMode
  proxyBaseUrl?: string
  observabilitySinkMode?: ObservabilitySinkMode
  observabilitySinkTarget?: ObservabilitySinkTarget
  observabilitySinkEndpointUrl?: string
  observabilitySinkApiKeyConfigured?: boolean
  observabilitySinkUserOptIn?: boolean
  observabilitySinkWorkspaceConsent?: boolean
  observabilitySinkDevelopmentOnly?: boolean
  observabilitySinkAllowRawPayloads?: boolean
  observabilitySinkAttributeLimit?: number
  observabilitySinkAttributeStringLimit?: number
  observabilitySinkHighFrequencyExportMode?: ObservabilitySinkHighFrequencyExportMode
  providerAllowlist?: string[]
  providerBlocklist?: string[]
  modelAllowlist?: string[]
  modelBlocklist?: string[]
  runtimeLogEnabled?: boolean
  runtimeLogMaxBytes?: number
  sessionConcurrencyLimit?: number
  sessionQueueTimeoutMs?: number
  sessionAffinityEnabled?: boolean
  sessionAffinityTtlMs?: number
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
