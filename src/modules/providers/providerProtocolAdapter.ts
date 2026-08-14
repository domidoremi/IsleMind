import type { AIProvider } from '@/types/providerContracts'
import type { OpenAIRequestInput } from './providerOpenAIRequestPolicy'

export type ProviderProtocolAdapterId =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic'
  | 'google'
  | 'openai-compatible-chat'
  | 'openai-compatible-responses'
  | 'openai-compatible-anthropic'
  | 'xiaomi-mimo-chat'
  | 'xiaomi-mimo-anthropic'

export type ProviderProtocolBodyTarget =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic'
  | 'google'
  | 'xiaomi-mimo-anthropic'

export interface ProviderProtocolRequest extends OpenAIRequestInput {
  provider: AIProvider
}

export interface ProviderProtocolBodyBuilders<TRequest extends ProviderProtocolRequest> {
  openAIChat: (request: TRequest) => Record<string, unknown>
  openAIResponses: (request: TRequest) => Record<string, unknown>
  anthropic: (request: TRequest) => Record<string, unknown>
  google: (request: TRequest) => Record<string, unknown>
  xiaomiMimoAnthropic: (request: TRequest) => Record<string, unknown>
}

export interface ProviderProtocolAdapter<TRequest extends ProviderProtocolRequest = ProviderProtocolRequest> {
  id: ProviderProtocolAdapterId
  bodyTarget: ProviderProtocolBodyTarget
  protocol: 'openai-chat' | 'openai-responses' | 'anthropic' | 'anthropic-compatible' | 'google'
  buildBody: (request: TRequest, builders: ProviderProtocolBodyBuilders<TRequest>) => Record<string, unknown>
}

export interface ProviderProtocolBodyResult<TRequest extends ProviderProtocolRequest> {
  adapter: ProviderProtocolAdapter<TRequest>
  body: Record<string, unknown>
}

export interface ProviderProtocolBodyBuilder<TRequest extends ProviderProtocolRequest> {
  build(request: TRequest): ProviderProtocolBodyResult<TRequest>
}

export interface ProviderProtocolAdapterPolicy<TRequest extends ProviderProtocolRequest> {
  resolve(request: TRequest): ProviderProtocolAdapter<TRequest>
  bindBodyBuilders(builders: ProviderProtocolBodyBuilders<TRequest>): ProviderProtocolBodyBuilder<TRequest>
}

export interface ProviderProtocolAdapterPolicyDependencies<TRequest extends ProviderProtocolRequest> {
  usesOpenAIResponses(request: TRequest): boolean
}

const OPENAI_CHAT_ADAPTER = adapter('openai-chat', 'openai-chat', 'openai-chat')
const OPENAI_RESPONSES_ADAPTER = adapter('openai-responses', 'openai-responses', 'openai-responses')
const ANTHROPIC_ADAPTER = adapter('anthropic', 'anthropic', 'anthropic')
const GOOGLE_ADAPTER = adapter('google', 'google', 'google')
const OPENAI_COMPATIBLE_CHAT_ADAPTER = adapter('openai-compatible-chat', 'openai-chat', 'openai-chat')
const OPENAI_COMPATIBLE_RESPONSES_ADAPTER = adapter('openai-compatible-responses', 'openai-responses', 'openai-responses')
const OPENAI_COMPATIBLE_ANTHROPIC_ADAPTER = adapter('openai-compatible-anthropic', 'anthropic', 'anthropic-compatible')
const XIAOMI_MIMO_CHAT_ADAPTER = adapter('xiaomi-mimo-chat', 'openai-chat', 'openai-chat')
const XIAOMI_MIMO_ANTHROPIC_ADAPTER = adapter('xiaomi-mimo-anthropic', 'xiaomi-mimo-anthropic', 'anthropic-compatible')

/** Owns protocol selection and binds each selected protocol to its body builder. */
export function createProviderProtocolAdapterPolicy<TRequest extends ProviderProtocolRequest>(
  dependencies: ProviderProtocolAdapterPolicyDependencies<TRequest>,
): ProviderProtocolAdapterPolicy<TRequest> {
  function resolve(request: TRequest): ProviderProtocolAdapter<TRequest> {
    switch (request.provider.type) {
      case 'openai':
        return castAdapter(dependencies.usesOpenAIResponses(request) ? OPENAI_RESPONSES_ADAPTER : OPENAI_CHAT_ADAPTER)
      case 'anthropic':
        return castAdapter(ANTHROPIC_ADAPTER)
      case 'google':
        return castAdapter(GOOGLE_ADAPTER)
      case 'openai-compatible':
        if (request.provider.wireProtocol === 'anthropic-compatible') return castAdapter(OPENAI_COMPATIBLE_ANTHROPIC_ADAPTER)
        return castAdapter(dependencies.usesOpenAIResponses(request) ? OPENAI_COMPATIBLE_RESPONSES_ADAPTER : OPENAI_COMPATIBLE_CHAT_ADAPTER)
      case 'xiaomi-mimo':
        return castAdapter(request.provider.wireProtocol === 'anthropic-compatible' ? XIAOMI_MIMO_ANTHROPIC_ADAPTER : XIAOMI_MIMO_CHAT_ADAPTER)
    }
  }

  return {
    resolve,
    bindBodyBuilders(builders) {
      return {
        build(request) {
          const selectedAdapter = resolve(request)
          return {
            adapter: selectedAdapter,
            body: selectedAdapter.buildBody(request, builders),
          }
        },
      }
    },
  }
}

function adapter(
  id: ProviderProtocolAdapterId,
  bodyTarget: ProviderProtocolBodyTarget,
  protocol: ProviderProtocolAdapter['protocol'],
): ProviderProtocolAdapter {
  return {
    id,
    bodyTarget,
    protocol,
    buildBody: (request, builders) => buildBodyForTarget(bodyTarget, request, builders),
  }
}

function buildBodyForTarget<TRequest extends ProviderProtocolRequest>(
  target: ProviderProtocolBodyTarget,
  request: TRequest,
  builders: ProviderProtocolBodyBuilders<TRequest>,
): Record<string, unknown> {
  switch (target) {
    case 'openai-chat': return builders.openAIChat(request)
    case 'openai-responses': return builders.openAIResponses(request)
    case 'anthropic': return builders.anthropic(request)
    case 'google': return builders.google(request)
    case 'xiaomi-mimo-anthropic': return builders.xiaomiMimoAnthropic(request)
  }
}

function castAdapter<TRequest extends ProviderProtocolRequest>(
  selectedAdapter: ProviderProtocolAdapter,
): ProviderProtocolAdapter<TRequest> {
  return selectedAdapter as unknown as ProviderProtocolAdapter<TRequest>
}
