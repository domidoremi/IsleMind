import type { ChatRequest, StreamEvent } from '@/core'
import {
  PROVIDER_CAPABILITIES,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderDescriptor,
  type ProviderFallbackRoute,
  type ProviderGateway,
  type ProviderGatewayOptions,
  type ProviderGatewayRuntimeStream,
} from './contracts'

export class UnknownProviderError extends Error {
  constructor(providerId: string) {
    super(`No provider adapter is registered for ${providerId}.`)
    this.name = 'UnknownProviderError'
  }
}

export class UnsupportedProviderCapabilityError extends Error {
  readonly providerId: string
  readonly unsupportedCapabilities: readonly string[]

  constructor(providerId: string, unsupportedCapabilities: readonly string[]) {
    super(`Provider adapter ${providerId} does not support the requested capabilities: ${unsupportedCapabilities.join(', ')}.`)
    this.name = 'UnsupportedProviderCapabilityError'
    this.providerId = providerId
    this.unsupportedCapabilities = unsupportedCapabilities
  }
}

export class ProviderRuntimeStreamUnavailableError extends Error {
  constructor() {
    super('The provider runtime stream adapter is not configured.')
    this.name = 'ProviderRuntimeStreamUnavailableError'
  }
}

export class ProviderContinuationBindingError extends Error {
  constructor(message = 'The provider continuation binding is invalid.') {
    super(message)
    this.name = 'ProviderContinuationBindingError'
  }
}

export function createProviderGateway(
  adapters: readonly ProviderAdapter[],
  runtimeStream?: ProviderGatewayRuntimeStream,
): ProviderGateway {
  const adaptersById = new Map<string, RegisteredAdapter>()
  for (const adapter of adapters) {
    const providerId = adapter.providerId.trim()
    if (!providerId) {
      throw new Error('Provider adapters require a non-empty provider ID.')
    }
    if (adaptersById.has(providerId)) {
      throw new Error(`Provider adapter ${adapter.providerId} is registered more than once.`)
    }
    adaptersById.set(providerId, {
      adapter,
      descriptor: {
        id: providerId,
        capabilities: normalizeCapabilities(adapter.capabilities),
      },
    })
  }

  return {
    stream(request: ChatRequest, options: ProviderGatewayOptions): AsyncIterable<StreamEvent> {
      return streamWithFallback(adaptersById, request, options)
    },

    startRuntimeStream(request, callbacks) {
      if (!runtimeStream) {
        return Promise.reject(new ProviderRuntimeStreamUnavailableError())
      }
      return runtimeStream.start(request, callbacks)
    },

    describe(providerId: string): ProviderDescriptor | undefined {
      return adaptersById.get(providerId)?.descriptor
    },
  }
}

interface RegisteredAdapter {
  adapter: ProviderAdapter
  descriptor: ProviderDescriptor
}

async function* streamWithFallback(
  adaptersById: ReadonlyMap<string, RegisteredAdapter>,
  request: ChatRequest,
  options: ProviderGatewayOptions,
): AsyncIterable<StreamEvent> {
  if (request.providerStateBinding && (
    request.providerStateBinding.providerId !== request.providerId
    || request.providerStateBinding.model !== request.model
  )) {
    throw new ProviderContinuationBindingError()
  }
  const routes = uniqueRoutes(request, options)
  let lastError: unknown

  for (const route of routes) {
    if (options.signal.aborted) return
    const registered = adaptersById.get(route.providerId)
    if (!registered) {
      lastError = new UnknownProviderError(route.providerId)
      continue
    }

    const unsupported = unsupportedCapabilities(request, registered.descriptor.capabilities)
    if (unsupported.length) {
      lastError = new UnsupportedProviderCapabilityError(route.providerId, unsupported)
      continue
    }

    let emitted = false
    try {
      await options.onRouteSelected?.(route)
      if (options.signal.aborted) return
      for await (const event of registered.adapter.stream({ ...request, providerId: route.providerId, model: route.model }, options)) {
        if (options.signal.aborted) return
        emitted = true
        yield event
      }
      return
    } catch (error) {
      if (options.signal.aborted || emitted) throw error
      lastError = error
    }
  }

  if (lastError) throw lastError
  throw new UnknownProviderError(request.providerId)
}

function normalizeCapabilities(value: readonly ProviderCapability[] | undefined): readonly ProviderCapability[] {
  const source: readonly ProviderCapability[] = value?.length ? value : ['chat']
  const allowed = new Set<string>(PROVIDER_CAPABILITIES)
  const capabilities = Array.from(new Set(source.filter((capability) => allowed.has(capability))))
  return capabilities.length ? capabilities : ['chat']
}

function unsupportedCapabilities(request: ChatRequest, capabilities: readonly ProviderCapability[]): string[] {
  const supported = new Set<string>(capabilities)
  return Array.from(new Set(request.requestedCapabilities ?? []))
    .filter((capability) => !supported.has(capability))
}

function uniqueRoutes(request: ChatRequest, options: ProviderGatewayOptions): ProviderFallbackRoute[] {
  if (request.providerStateBinding) {
    return [{
      providerId: request.providerStateBinding.providerId,
      model: request.providerStateBinding.model,
    }]
  }
  const fallbackRoutes = options.resolveFallbackRoutes?.(request) ?? options.fallbackRoutes ?? []
  const routes = [
    { providerId: request.providerId, model: request.model },
    ...fallbackRoutes,
    ...(options.fallbackProviderIds ?? []).map((providerId) => ({ providerId, model: request.model })),
  ]
  const seen = new Set<string>()
  return routes.flatMap((route) => {
    const providerId = route.providerId.trim()
    const model = route.model.trim()
    if (!providerId || !model) return []
    const key = `${providerId}\u0000${model}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ providerId, model }]
  })
}
