import type { ChatRequest, StreamEvent } from '@/core'
import type {
  ProviderRuntimeChatCallbacks,
  ProviderRuntimeChatRequest,
  ProviderRuntimeChatStreamRuntime,
  ProviderRuntimeStreamHandle,
} from './providerRuntimeContracts'

export const PROVIDER_CAPABILITIES = [
  'chat',
  'vision',
  'files',
  'audio',
  'tools',
  'structured-output',
] as const

export type ProviderCapability = typeof PROVIDER_CAPABILITIES[number]

export interface ProviderFallbackRoute {
  providerId: string
  model: string
}

export interface ProviderGatewayOptions {
  signal: AbortSignal
  /**
   * Ordered alternatives to try only when the selected adapter fails before
   * emitting an event. The primary provider always remains first.
   */
  fallbackProviderIds?: readonly string[]
  /**
   * Route-level alternatives can select a compatible model rather than
   * assuming every fallback provider accepts the primary request model.
   */
  fallbackRoutes?: readonly ProviderFallbackRoute[]
  resolveFallbackRoutes?: (request: ChatRequest) => readonly ProviderFallbackRoute[]
  onRouteSelected?: (route: ProviderFallbackRoute) => void | Promise<void>
}

export interface ProviderAdapter {
  providerId: string
  /**
   * The adapter's protocol-level capabilities. Unspecified adapters remain
   * compatible with the walking skeleton and are treated as chat-only.
   */
  capabilities?: readonly ProviderCapability[]
  stream(request: ChatRequest, options: ProviderGatewayOptions): AsyncIterable<StreamEvent>
}

export interface ProviderDescriptor {
  id: string
  capabilities: readonly ProviderCapability[]
}

export interface ProviderGateway {
  stream(request: ChatRequest, options: ProviderGatewayOptions): AsyncIterable<StreamEvent>
  /**
   * Transitional rich-Chat entry point. It preserves the complete provider
   * runtime request and terminal receipt while the canonical StreamEvent
   * protocol is expanded without dropping observable Chat behavior.
   */
  startRuntimeStream(
    request: ProviderRuntimeChatRequest,
    callbacks: ProviderRuntimeChatCallbacks,
  ): Promise<ProviderRuntimeStreamHandle>
  describe(providerId: string): ProviderDescriptor | undefined
}

export type ProviderGatewayRuntimeStream = Pick<ProviderRuntimeChatStreamRuntime, 'start'>

/** Provider-neutral configuration used by the active same-provider fallback policy. */
export interface ProviderFallbackModelDescriptor {
  id: string
  deprecated?: boolean
  capabilities?: readonly ProviderCapability[]
}

export interface ProviderFallbackCredentialDescriptor {
  enabled: boolean
  hasCredential: boolean
  availableModels?: readonly string[]
}

export interface SameProviderFallbackDescriptor {
  providerId: string
  enabled: boolean
  models: readonly ProviderFallbackModelDescriptor[]
  credentials: readonly ProviderFallbackCredentialDescriptor[]
}
