export type ThemeMode = 'light' | 'dark' | 'system'
export type ThemeBackgroundVariation = 'fixed' | 'random' | 'startup' | 'daily' | 'preset'
export type ThemeBackgroundMotion = 'static' | 'subtle' | 'dynamic' | 'immersive'
export type ThemeBackgroundIntensity = 'low' | 'medium' | 'high'
/** The only product theme identities accepted by storage, tools, and runtime code. */
export type CanonicalThemeId = 'minimal' | 'monet' | 'material' | 'liquid-glass'
export type ThemeId = CanonicalThemeId

/**
 * The persisted/settings boundary is the single source of truth for theme
 * identity. Presentation code consumes the same values without an alias or
 * presentation-id translation layer.
 */
export const CANONICAL_THEME_IDS = ['minimal', 'monet', 'material', 'liquid-glass'] as const satisfies readonly CanonicalThemeId[]
export const THEME_MODE_VALUES = ['light', 'dark', 'system'] as const satisfies readonly ThemeMode[]
export const THEME_TOKEN_MODE_VALUES = ['light', 'dark'] as const satisfies readonly Exclude<ThemeMode, 'system'>[]

const THEME_ACCENT_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const THEME_ACCENT_RESET_VALUES = new Set(['', 'auto', 'default', 'none', 'reset'])

/** Normalize untrusted mode input without ever returning an invalid mode. */
export function normalizeThemeModeValue(value: unknown): ThemeMode | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return (THEME_MODE_VALUES as readonly string[]).includes(normalized)
    ? normalized as ThemeMode
    : undefined
}

/** Accept canonical family ids only; stale/corrupt values fail closed. */
export function normalizeThemeFamilyValue(value: unknown): CanonicalThemeId | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return (CANONICAL_THEME_IDS as readonly string[]).includes(normalized)
    ? normalized as CanonicalThemeId
    : undefined
}

/** Normalize the intentionally small, serializable custom accent contract. */
export function normalizeThemeAccentValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.trim().match(THEME_ACCENT_PATTERN)
  if (!match) return undefined
  const hex = match[1]
  const expanded = hex.length === 3
    ? hex.split('').map((part) => `${part}${part}`).join('')
    : hex
  return `#${expanded.toUpperCase()}`
}

export function isThemeAccentResetValue(value: unknown): boolean {
  return typeof value === 'string' && THEME_ACCENT_RESET_VALUES.has(value.trim().toLowerCase())
}

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
  backgroundVariation?: ThemeBackgroundVariation
  backgroundMotion?: ThemeBackgroundMotion
  backgroundIntensity?: ThemeBackgroundIntensity
  backgroundPreset?: number
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
  /** Vendor-specific native compaction thresholds; legacy field remains a fallback. */
  anthropicRemoteCompactThresholdTokens?: number
  openAIRemoteCompactThresholdTokens?: number
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
