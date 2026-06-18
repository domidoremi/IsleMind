import { resolveProviderEndpoint } from '@/services/ai/providerRouteAssembly'
import { usesOpenAIResponses, type OpenAIRequestInput } from '@/services/ai/providerOpenAIRequest'

export function endpointHost(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

export function toWebSocketUrl(url: string): string {
  const parsed = new URL(url)
  parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:'
  return parsed.toString()
}

export function resolveNonStreamingProviderEndpoint(req: OpenAIRequestInput): string {
  return resolveProviderEndpoint({
    provider: req.provider,
    model: req.model,
    stream: false,
    usesResponsesApi: usesOpenAIResponses(req),
  })
}
