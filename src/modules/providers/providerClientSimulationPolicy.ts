import type {
  AIProvider,
  ProviderClientCompatibilityMode,
  ProviderClientSimulationProfileId,
} from '@/types/providerContracts'

export type {
  ProviderClientCompatibilityMode,
  ProviderClientSimulationProfileId,
} from '@/types/providerContracts'

export type ProviderClientSimulationMatch =
  | 'default'
  | 'selected-model'
  | 'explicit-provider-identity'
  | 'explicit-profile'
  | 'explicit-islemind'
  | 'incompatible-profile'

export interface ProviderClientSimulationInput {
  provider: Pick<
    AIProvider,
    | 'id'
    | 'type'
    | 'name'
    | 'baseUrl'
    | 'presetId'
    | 'detectedPresetId'
    | 'wireProtocol'
    | 'clientCompatibilityProfile'
  >
  /** The effective selected model is the primary automatic client-identity signal. */
  model?: string
  /** Authentication affects auth-only headers, never automatic UA selection. */
  authentication?: 'api-key' | 'oauth'
}

export interface ProviderClientSimulationDecision {
  profileId: ProviderClientSimulationProfileId
  compatibilityTarget?: Exclude<ProviderClientSimulationProfileId, 'islemind'>
  match: ProviderClientSimulationMatch
  userAgent: string
  requestHeaders: Readonly<Record<string, string>>
  identity: 'islemind'
  proprietaryTelemetryEmulated: false
}

const CLIENT_USER_AGENTS: Record<ProviderClientSimulationProfileId, string> = {
  islemind: 'IsleMind/1.0.15',
  'codex-cli': 'codex_cli_rs/0.147.0 (Android; mobile) IsleMind/1.0.15',
  'codex-desktop': 'Codex Desktop/0.147.0 (Android; mobile) IsleMind/1.0.15',
  'claude-code': 'claude-code/2.1.229 (cli; IsleMind/1.0.15)',
  'claude-code-desktop': 'claude-code/2.1.229 (desktop; IsleMind/1.0.15)',
  // Grok Build 1.0.3 official binary evidence: grok-pager + grok-shell,
  // Windows x86_64, and the matching client version/identifier headers.
  'grok-build': 'grok-pager/1.0.3 grok-shell/1.0.3 (windows; x86_64)',
  'openai-api': 'OpenAI-API/1.0 (IsleMind/1.0.15)',
  'anthropic-api': 'Anthropic-API/1.0 (IsleMind/1.0.15)',
  // These suppliers publish OpenAI-compatible HTTP APIs but no canonical CLI
  // telemetry contract. Keep the compatibility target explicit and honest.
  'deepseek-api': 'DeepSeek-API/1.0 (IsleMind/1.0.15)',
  'glm-api': 'GLM-API/1.0 (IsleMind/1.0.15)',
}

const GROK_SHELL_VERSION = '1.0.3'

type ProviderClientProtocolFamily = 'openai' | 'anthropic' | 'google'

const PROVIDER_CLIENT_COMPATIBILITY_MODES: readonly ProviderClientCompatibilityMode[] = [
  'auto',
  'islemind',
  'codex-cli',
  'codex-desktop',
  'claude-code',
  'claude-code-desktop',
  'grok-build',
]

const BASE_PROVIDER_CLIENT_COMPATIBILITY_MODES = [
  'auto',
  'islemind',
] as const satisfies readonly ProviderClientCompatibilityMode[]

const OPENAI_PROVIDER_CLIENT_COMPATIBILITY_MODES = [
  ...BASE_PROVIDER_CLIENT_COMPATIBILITY_MODES,
  'codex-cli',
  'codex-desktop',
  'grok-build',
] as const satisfies readonly ProviderClientCompatibilityMode[]

const ANTHROPIC_PROVIDER_CLIENT_COMPATIBILITY_MODES = [
  ...BASE_PROVIDER_CLIENT_COMPATIBILITY_MODES,
  'claude-code',
  'claude-code-desktop',
] as const satisfies readonly ProviderClientCompatibilityMode[]

/** Normalizes persisted or imported compatibility input to a known mode. */
export function normalizeProviderClientCompatibilityMode(
  value: unknown,
): ProviderClientCompatibilityMode {
  return typeof value === 'string' && PROVIDER_CLIENT_COMPATIBILITY_MODES.includes(
    value as ProviderClientCompatibilityMode,
  )
    ? value as ProviderClientCompatibilityMode
    : 'auto'
}

/** Returns only the compatibility modes supported by the provider protocol. */
export function getCompatibleProviderClientCompatibilityModes(
  provider: Pick<AIProvider, 'type' | 'wireProtocol'>,
): readonly ProviderClientCompatibilityMode[] {
  switch (providerClientProtocolFamily(provider)) {
    case 'openai':
      return OPENAI_PROVIDER_CLIENT_COMPATIBILITY_MODES
    case 'anthropic':
      return ANTHROPIC_PROVIDER_CLIENT_COMPATIBILITY_MODES
    case 'google':
      return BASE_PROVIDER_CLIENT_COMPATIBILITY_MODES
  }
}

/**
 * Selects one compatibility identity for the effective selected model.
 *
 * Explicit provider settings remain authoritative. Automatic mode follows the
 * selected model first so a multi-model relay uses the matching client UA for
 * Grok, Codex, GPT, Claude, DeepSeek, and GLM requests. Provider identity is a
 * fallback when no supported model family can be identified.
 */
export function resolveProviderClientSimulationPolicy(
  input: ProviderClientSimulationInput,
): ProviderClientSimulationDecision {
  const compatibilityMode = normalizeProviderClientCompatibilityMode(
    input.provider.clientCompatibilityProfile,
  )
  if (compatibilityMode !== 'auto') {
    if (compatibilityMode === 'islemind') {
      return decision('islemind', 'explicit-islemind')
    }
    if (getCompatibleProviderClientCompatibilityModes(input.provider).includes(compatibilityMode)) {
      return decision(compatibilityMode, 'explicit-profile', input.authentication)
    }
    return decision('islemind', 'incompatible-profile')
  }

  const selectedModelProfile = resolveSelectedModelProfile(input.model)
  if (selectedModelProfile) {
    return decision(selectedModelProfile, 'selected-model', input.authentication)
  }

  const identity = providerIdentity(input.provider)
  const protocolFamily = providerClientProtocolFamily(input.provider)
  const anthropicWire = protocolFamily === 'anthropic'
  const openAIWire = protocolFamily === 'openai'

  if (openAIWire && hasCodexDesktopIdentity(identity)) {
    return decision('codex-desktop', 'explicit-provider-identity')
  }

  if (openAIWire && hasCodexCliIdentity(identity)) {
    return decision('codex-cli', 'explicit-provider-identity')
  }

  if (openAIWire && hasGrokBuildIdentity(identity)) {
    return decision('grok-build', 'explicit-provider-identity', input.authentication)
  }

  if (openAIWire && hasDeepSeekIdentity(identity)) {
    return decision('deepseek-api', 'explicit-provider-identity')
  }

  if (openAIWire && hasGlmIdentity(identity)) {
    return decision('glm-api', 'explicit-provider-identity')
  }

  if (anthropicWire && hasClaudeCodeDesktopIdentity(identity)) {
    return decision('claude-code-desktop', 'explicit-provider-identity')
  }

  if (anthropicWire && hasClaudeCodeIdentity(identity)) {
    return decision('claude-code', 'explicit-provider-identity')
  }

  if (isDirectOpenAIApiProvider(input.provider)) {
    return decision('openai-api', 'explicit-provider-identity')
  }

  if (isDirectAnthropicApiProvider(input.provider)) {
    return decision('anthropic-api', 'explicit-provider-identity')
  }

  return decision('islemind', 'default')
}

const PROVIDER_CLIENT_SIMULATION_HEADER_NAMES = new Set([
  'user-agent',
  'x-grok-client-version',
  'x-grok-client-identifier',
  'x-xai-token-auth',
])

/** Applies the policy-owned headers with one canonical name and value per field. */
export function applyProviderClientSimulationHeaders(
  headers: Readonly<Record<string, string>>,
  input: ProviderClientSimulationInput,
): Record<string, string> {
  const policy = resolveProviderClientSimulationPolicy(input)
  const merged: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!PROVIDER_CLIENT_SIMULATION_HEADER_NAMES.has(name.toLowerCase())) {
      merged[name] = value
    }
  }
  return { ...merged, ...policy.requestHeaders }
}

function decision(
  profileId: ProviderClientSimulationProfileId,
  match: ProviderClientSimulationMatch,
  authentication: ProviderClientSimulationInput['authentication'] = 'api-key',
): ProviderClientSimulationDecision {
  const userAgent = CLIENT_USER_AGENTS[profileId]
  const requestHeaders = profileId === 'grok-build'
    ? {
        'User-Agent': userAgent,
        'x-grok-client-version': GROK_SHELL_VERSION,
        'x-grok-client-identifier': 'grok-shell',
        ...(authentication === 'oauth' ? { 'X-XAI-Token-Auth': 'xai-grok-cli' } : {}),
      }
    : { 'User-Agent': userAgent }
  return {
    profileId,
    ...(profileId === 'islemind' ? {} : { compatibilityTarget: profileId }),
    match,
    userAgent,
    requestHeaders,
    identity: 'islemind',
    proprietaryTelemetryEmulated: false,
  }
}

function providerIdentity(provider: ProviderClientSimulationInput['provider']): string {
  return normalize([
    provider.id,
    provider.name,
    provider.baseUrl,
    provider.presetId,
    provider.detectedPresetId,
    provider.type,
  ].filter(Boolean).join(' '))
}

function resolveSelectedModelProfile(model: string | undefined): ProviderClientSimulationProfileId | undefined {
  const identity = normalize(model)
  if (!identity) return undefined
  if (/(?:^|-)grok(?:-|$)/.test(identity)) return 'grok-build'
  if (/(?:^|-)codex(?:-|$)/.test(identity)) return 'codex-cli'
  if (/(?:^|-)claude(?:-|$)/.test(identity)) return 'claude-code'
  if (/(?:^|-)deepseek(?:-|$)/.test(identity)) return 'deepseek-api'
  if (/(?:^|-)(?:glm|chatglm)(?:-|$)/.test(identity)) return 'glm-api'
  if (/(?:^|-)(?:gpt|openai-o[134])(?:-|$)/.test(identity)) return 'openai-api'
  return undefined
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') ?? ''
}

function hasCodexDesktopIdentity(identity: string): boolean {
  return /(?:^|-)codex-(?:desktop|app)(?:-|$)/.test(identity)
}

function hasCodexCliIdentity(identity: string): boolean {
  return /(?:^|-)codex-cli(?:-|$)/.test(identity)
}

function hasClaudeCodeDesktopIdentity(identity: string): boolean {
  return /(?:^|-)claude-(?:code-)?desktop(?:-|$)/.test(identity)
}

function hasClaudeCodeIdentity(identity: string): boolean {
  return /(?:^|-)claude-code(?:-|$)/.test(identity)
}

function hasGrokBuildIdentity(identity: string): boolean {
  return /(?:^|-)grok(?:-build|-shell)?(?:-|$)|(?:^|-)xai(?:-|$)|api-x-ai/.test(identity)
}

function hasDeepSeekIdentity(identity: string): boolean {
  return /(?:^|-)deepseek(?:-|$)|api-deepseek-com/.test(identity)
}

function hasGlmIdentity(identity: string): boolean {
  return /(?:^|-)glm(?:-|$)|(?:^|-)bigmodel(?:-|$)|open-bigmodel-cn/.test(identity)
}

function isDirectOpenAIApiProvider(provider: ProviderClientSimulationInput['provider']): boolean {
  return provider.type === 'openai' && (!provider.presetId || provider.presetId === 'openai')
}

function isDirectAnthropicApiProvider(provider: ProviderClientSimulationInput['provider']): boolean {
  return provider.type === 'anthropic' && (!provider.presetId || provider.presetId === 'anthropic')
}

function providerClientProtocolFamily(
  provider: Pick<AIProvider, 'type' | 'wireProtocol'>,
): ProviderClientProtocolFamily {
  if (provider.type === 'google') return 'google'
  if (provider.type === 'anthropic' || provider.wireProtocol === 'anthropic-compatible') return 'anthropic'
  return 'openai'
}
