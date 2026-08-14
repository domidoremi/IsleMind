import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { WebSearchMode } from '@/types/settingsContracts'
import { isXAIProvider } from './providerIdentityPolicy'

export type ProviderBuiltinToolKind = 'openai-responses-web-search'

export type ProviderBuiltinToolBlockReason =
  | 'known_family_rejects_openai_builtin_search'
  | 'gemini_compatible_route_rejects_openai_builtin_search'
  | 'longcat_compatible_route_rejects_openai_builtin_search'
  | 'qwen3_coder_route_rejects_openai_builtin_search'
  | 'mimo_compatible_route_requires_provider_native_search_shape'

export interface ProviderBuiltinToolPolicy {
  toolKind: ProviderBuiltinToolKind
  allowed: boolean
  providerId: string
  model: string
  reason?: ProviderBuiltinToolBlockReason
  fallback: 'send_builtin_tool' | 'omit_builtin_tool' | 'use_provider_native_shape'
}

export interface ProviderNativeSearchRequest {
  provider: AIProvider
  model: string
  webSearchMode?: WebSearchMode
}

export interface ProviderNativeSearchPolicyDependencies<
  Request extends ProviderNativeSearchRequest,
> {
  providerNativeSearchCanBeSent(provider: AIProvider, explicitDeclaration: boolean): boolean
  requestModelCapabilityCanBeSent(request: Request, capability: 'nativeSearch'): boolean
  openAIResponsesTool(provider: AIProvider, model?: string): Record<string, unknown> | undefined
}

export interface ProviderNativeSearchPolicy<Request extends ProviderNativeSearchRequest> {
  openAIChat(request: Request): Record<string, unknown> | undefined
  openAIResponses(request: Request): Record<string, unknown> | undefined
  anthropic(request: Request): Record<string, unknown> | undefined
  google(request: Request): Record<string, unknown> | undefined
}

export type ProviderNativeSearchSupportModel = Pick<
  AIModel,
  'id' | 'chatCompatible' | 'preferredEndpoint'
>

export interface ProviderNativeSearchSupportPolicyDependencies {
  compatibilityCapabilityCanBeSent(
    provider: AIProvider,
    capability: 'nativeSearch',
    explicitDeclaration: boolean,
  ): boolean
  resolveOpenAIResponsesSearchPolicy(
    provider: AIProvider,
    model: string,
  ): { allowed: boolean }
}

export interface ProviderNativeSearchSupportPolicy {
  providerSupportsNativeSearch(
    provider: AIProvider,
    model?: ProviderNativeSearchSupportModel,
  ): boolean
}

/** Owns provider/model native-search support admission without selecting a wire tool shape. */
export function createProviderNativeSearchSupportPolicy(
  dependencies: ProviderNativeSearchSupportPolicyDependencies,
): ProviderNativeSearchSupportPolicy {
  return {
    providerSupportsNativeSearch(provider, model) {
      const explicitDeclaration = provider.capabilities?.nativeSearch === true
      if (!dependencies.compatibilityCapabilityCanBeSent(provider, 'nativeSearch', explicitDeclaration)) return false
      if (!model) return true
      if (model.chatCompatible === false) return false
      if (provider.type !== 'openai-compatible' || provider.wireProtocol === 'anthropic-compatible') return true
      if (provider.capabilities?.responsesApi !== true && model.preferredEndpoint !== 'responses') return true
      return dependencies.resolveOpenAIResponsesSearchPolicy(provider, model.id).allowed
    },
  }
}

export function resolveOpenAIResponsesWebSearchToolPolicy(
  provider: AIProvider,
  model: string,
): ProviderBuiltinToolPolicy {
  const toolKind: ProviderBuiltinToolKind = 'openai-responses-web-search'
  const allow = (): ProviderBuiltinToolPolicy => ({
    toolKind,
    allowed: true,
    providerId: provider.id,
    model,
    fallback: 'send_builtin_tool',
  })
  const block = (
    reason: ProviderBuiltinToolBlockReason,
    fallback: ProviderBuiltinToolPolicy['fallback'] = 'omit_builtin_tool',
  ): ProviderBuiltinToolPolicy => ({
    toolKind,
    allowed: false,
    providerId: provider.id,
    model,
    reason,
    fallback,
  })

  if (provider.type === 'openai') return allow()
  if (isXAIProvider(provider)) return allow()

  const route = providerBuiltinToolRouteIdentity(provider, model)
  if (providerBuiltinToolRouteIsMiMo(provider, route)) {
    return block('mimo_compatible_route_requires_provider_native_search_shape', 'use_provider_native_shape')
  }
  if (providerBuiltinToolRouteIsMiniMax(provider, route)) {
    return block('known_family_rejects_openai_builtin_search')
  }
  if (providerBuiltinToolRouteIsLongCat(route)) {
    return block('longcat_compatible_route_rejects_openai_builtin_search')
  }
  if (providerBuiltinToolRouteIsQwen3Coder(route)) {
    return block('qwen3_coder_route_rejects_openai_builtin_search')
  }
  if (providerBuiltinToolRouteIsGeminiCompatible(provider, route)) {
    return block('gemini_compatible_route_rejects_openai_builtin_search')
  }

  return allow()
}

export function explainProviderBuiltinToolBlockReason(reason: ProviderBuiltinToolBlockReason): string {
  switch (reason) {
    case 'known_family_rejects_openai_builtin_search':
      return 'known provider family rejects OpenAI Responses built-in web search tools'
    case 'gemini_compatible_route_rejects_openai_builtin_search':
      return 'Gemini through an OpenAI-compatible route does not imply OpenAI Responses built-in web search support'
    case 'longcat_compatible_route_rejects_openai_builtin_search':
      return 'LongCat compatible routes are treated as not accepting OpenAI Responses built-in web search tools'
    case 'qwen3_coder_route_rejects_openai_builtin_search':
      return 'Qwen3-Coder routes are treated as not accepting OpenAI Responses built-in web search tools'
    case 'mimo_compatible_route_requires_provider_native_search_shape':
      return 'MiMo search uses the provider-native Chat Completions web_search shape instead of OpenAI Responses web_search'
  }
}

/** Owns protocol-specific native-search admission and tool selection. */
export function createProviderNativeSearchPolicy<Request extends ProviderNativeSearchRequest>(
  dependencies: ProviderNativeSearchPolicyDependencies<Request>,
): ProviderNativeSearchPolicy<Request> {
  const requested = (request: Request): boolean => request.webSearchMode === 'native'
  const supported = (request: Request): boolean => dependencies.providerNativeSearchCanBeSent(
    request.provider,
    request.provider.capabilities?.nativeSearch === true,
  )

  return {
    openAIChat(request) {
      if (!requested(request) || request.provider.type !== 'xiaomi-mimo' || !supported(request)) return undefined
      return xiaomiMimoNativeWebSearchTool(request.model)
    },
    openAIResponses(request) {
      if (!requested(request) || !dependencies.requestModelCapabilityCanBeSent(request, 'nativeSearch')) return undefined
      return dependencies.openAIResponsesTool(request.provider, request.model)
    },
    anthropic(request) {
      if (!requested(request) || request.provider.type === 'xiaomi-mimo' || !supported(request)) return undefined
      return anthropicNativeWebSearchTool(
        request.model,
        request.provider.type === 'anthropic' && request.provider.wireProtocol !== 'anthropic-compatible'
          ? 'direct'
          : 'compatible',
      )
    },
    google(request) {
      if (!requested(request) || !supported(request)) return undefined
      return googleNativeWebSearchTool()
    },
  }
}

export function anthropicNativeWebSearchTool(
  modelId: string,
  route: 'direct' | 'compatible' = 'direct',
): Record<string, unknown> {
  const dynamicToolType = route === 'direct' ? 'web_search_20260318' : 'web_search_20260209'
  return {
    type: supportsAnthropicDynamicWebSearch(modelId) ? dynamicToolType : 'web_search_20250305',
    name: 'web_search',
    max_uses: 3,
  }
}

export function supportsAnthropicDynamicWebSearch(modelId: string): boolean {
  const normalized = modelId.toLowerCase().split('/').at(-1) ?? modelId.toLowerCase()
  return /^claude-(fable-5|mythos-5|mythos-preview|opus-4-[678]|sonnet-4-6)/.test(normalized)
}

export function googleNativeWebSearchTool(): Record<string, unknown> {
  return { google_search: {} }
}

export function supportsXiaomiMimoNativeWebSearch(modelId: string): boolean {
  const normalized = modelId.toLowerCase().split('/').at(-1) ?? modelId.toLowerCase()
  return /^mimo-v(?:2\.5(?:-pro)?|2-(?:pro|omni|flash))$/.test(normalized)
}

export function xiaomiMimoNativeWebSearchTool(modelId: string): Record<string, unknown> | undefined {
  if (!supportsXiaomiMimoNativeWebSearch(modelId)) return undefined
  return {
    type: 'web_search',
    max_keyword: 3,
    force_search: true,
    limit: 1,
  }
}

interface ProviderBuiltinToolRouteIdentity {
  host: string
  terminalModel: string
}

function providerBuiltinToolRouteIdentity(provider: AIProvider, model: string): ProviderBuiltinToolRouteIdentity {
  const normalizedModel = normalizeProviderBuiltinToolIdentityText(model)
  return {
    host: providerBuiltinToolBaseHost(provider.baseUrl),
    terminalModel: normalizedModel.split('/').filter(Boolean).at(-1) ?? normalizedModel,
  }
}

function providerBuiltinToolRouteIsMiMo(
  provider: AIProvider,
  route: ProviderBuiltinToolRouteIdentity,
): boolean {
  return provider.type === 'xiaomi-mimo' ||
    providerBuiltinToolPresetIs(provider, 'xiaomi-mimo') ||
    route.host.includes('xiaomimimo.com') ||
    /^mimo(?:[-_.]|$)|^xiaomi[-_]?mimo(?:[-_.]|$)/i.test(route.terminalModel)
}

function providerBuiltinToolRouteIsMiniMax(
  provider: AIProvider,
  route: ProviderBuiltinToolRouteIdentity,
): boolean {
  return providerBuiltinToolPresetIs(provider, 'minimax') ||
    /(?:^|\.)minimax\.(?:io|com)$|(?:^|\.)minimaxi\.com$/i.test(route.host) ||
    /^(?:mini[-_]?max|minimax)(?:[-_.]|$)/i.test(route.terminalModel)
}

function providerBuiltinToolRouteIsLongCat(route: ProviderBuiltinToolRouteIdentity): boolean {
  return /(?:^|\.)longcat\.chat$/i.test(route.host) ||
    /^(?:long[-_]?cat|longcat)(?:[-_.]|$)/i.test(route.terminalModel)
}

function providerBuiltinToolRouteIsQwen3Coder(route: ProviderBuiltinToolRouteIdentity): boolean {
  return /^qwen3[-_.]?coder(?:[-_.]|$)/i.test(route.terminalModel)
}

function providerBuiltinToolRouteIsGeminiCompatible(
  provider: AIProvider,
  route: ProviderBuiltinToolRouteIdentity,
): boolean {
  if (provider.type !== 'openai-compatible') return false
  return /(?:^|\.)generativelanguage\.googleapis\.com$|(?:^|\.)aiplatform\.googleapis\.com$/i.test(route.host) ||
    /^gemini(?:[-_.]|$)/i.test(route.terminalModel)
}

function providerBuiltinToolPresetIs(provider: AIProvider, presetId: string): boolean {
  return provider.presetId === presetId || provider.detectedPresetId === presetId
}

function providerBuiltinToolBaseHost(baseUrl: string | undefined): string {
  const value = normalizeProviderBuiltinToolIdentityText(baseUrl ?? '')
  if (!value) return ''
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return value.replace(/^https?:\/\//i, '').split('/')[0]?.toLowerCase() ?? value
  }
}

function normalizeProviderBuiltinToolIdentityText(value: string): string {
  return value.trim().toLowerCase()
}
