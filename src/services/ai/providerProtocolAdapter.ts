import type { AIProvider } from '@/types'
import type { OpenAIRequestInput } from '@/services/ai/providerOpenAIRequest'
import { usesOpenAIResponses } from '@/services/ai/providerOpenAIRequest'

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
  openAIChat: (req: TRequest) => Record<string, unknown>
  openAIResponses: (req: TRequest) => Record<string, unknown>
  anthropic: (req: TRequest) => Record<string, unknown>
  google: (req: TRequest) => Record<string, unknown>
  xiaomiMimoAnthropic: (req: TRequest) => Record<string, unknown>
}

export interface ProviderProtocolAdapter<TRequest extends ProviderProtocolRequest = ProviderProtocolRequest> {
  id: ProviderProtocolAdapterId
  bodyTarget: ProviderProtocolBodyTarget
  protocol: 'openai-chat' | 'openai-responses' | 'anthropic' | 'anthropic-compatible' | 'google'
  buildBody: (req: TRequest, builders: ProviderProtocolBodyBuilders<TRequest>) => Record<string, unknown>
}

export interface ProviderProtocolBodyResult<TRequest extends ProviderProtocolRequest> {
  adapter: ProviderProtocolAdapter<TRequest>
  body: Record<string, unknown>
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

export function resolveProviderProtocolAdapter<TRequest extends ProviderProtocolRequest>(
  req: TRequest
): ProviderProtocolAdapter<TRequest> {
  switch (req.provider.type) {
    case 'openai':
      return castAdapter(usesOpenAIResponses(req) ? OPENAI_RESPONSES_ADAPTER : OPENAI_CHAT_ADAPTER)
    case 'anthropic':
      return castAdapter(ANTHROPIC_ADAPTER)
    case 'google':
      return castAdapter(GOOGLE_ADAPTER)
    case 'openai-compatible':
      if (req.provider.wireProtocol === 'anthropic-compatible') return castAdapter(OPENAI_COMPATIBLE_ANTHROPIC_ADAPTER)
      return castAdapter(usesOpenAIResponses(req) ? OPENAI_COMPATIBLE_RESPONSES_ADAPTER : OPENAI_COMPATIBLE_CHAT_ADAPTER)
    case 'xiaomi-mimo':
      return castAdapter(req.provider.wireProtocol === 'anthropic-compatible' ? XIAOMI_MIMO_ANTHROPIC_ADAPTER : XIAOMI_MIMO_CHAT_ADAPTER)
  }
}

export function buildProviderProtocolBody<TRequest extends ProviderProtocolRequest>(
  req: TRequest,
  builders: ProviderProtocolBodyBuilders<TRequest>
): ProviderProtocolBodyResult<TRequest> {
  const adapter = resolveProviderProtocolAdapter(req)
  return {
    adapter,
    body: adapter.buildBody(req, builders),
  }
}

function adapter(
  id: ProviderProtocolAdapterId,
  bodyTarget: ProviderProtocolBodyTarget,
  protocol: ProviderProtocolAdapter['protocol']
): ProviderProtocolAdapter {
  return {
    id,
    bodyTarget,
    protocol,
    buildBody: (req, builders) => buildBodyForTarget(bodyTarget, req, builders),
  }
}

function buildBodyForTarget<TRequest extends ProviderProtocolRequest>(
  target: ProviderProtocolBodyTarget,
  req: TRequest,
  builders: ProviderProtocolBodyBuilders<TRequest>
): Record<string, unknown> {
  switch (target) {
    case 'openai-chat':
      return builders.openAIChat(req)
    case 'openai-responses':
      return builders.openAIResponses(req)
    case 'anthropic':
      return builders.anthropic(req)
    case 'google':
      return builders.google(req)
    case 'xiaomi-mimo-anthropic':
      return builders.xiaomiMimoAnthropic(req)
  }
}

function castAdapter<TRequest extends ProviderProtocolRequest>(
  adapter: ProviderProtocolAdapter
): ProviderProtocolAdapter<TRequest> {
  return adapter as unknown as ProviderProtocolAdapter<TRequest>
}
