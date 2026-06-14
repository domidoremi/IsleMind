import type { AIProvider, Settings } from '@/types'

export type UpstreamTransport = 'http_sse' | 'responses_websocket'

export interface TransportSelectionInput {
  provider: AIProvider
  usesResponsesApi: boolean
  stream?: boolean
  settings?: Pick<Settings, 'transportMode'>
  hasWebSocketRuntime?: boolean
}

export interface TransportSelection {
  transport: UpstreamTransport
  requestedMode: NonNullable<Settings['transportMode']>
  fallbackReason?: 'http_forced' | 'streaming_disabled' | 'non_responses_request' | 'provider_capability_missing' | 'websocket_runtime_missing'
}

export function selectUpstreamTransport(input: TransportSelectionInput): TransportSelection {
  const requestedMode = input.settings?.transportMode ?? 'auto'
  if (requestedMode === 'http') return { transport: 'http_sse', requestedMode, fallbackReason: 'http_forced' }
  if (!input.usesResponsesApi) return { transport: 'http_sse', requestedMode, fallbackReason: 'non_responses_request' }
  if (input.stream === false) return { transport: 'http_sse', requestedMode, fallbackReason: 'streaming_disabled' }
  const supportsWebSocket = input.provider.capabilities?.responsesApi === true && input.provider.capabilities?.responsesWebSocket === true
  if (!supportsWebSocket) return { transport: 'http_sse', requestedMode, fallbackReason: 'provider_capability_missing' }
  if (!input.hasWebSocketRuntime) return { transport: 'http_sse', requestedMode, fallbackReason: 'websocket_runtime_missing' }
  return { transport: 'responses_websocket', requestedMode }
}
