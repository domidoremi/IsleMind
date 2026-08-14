import { fetch as expoFetch } from 'expo/fetch'
import {
  createProviderRouteAssemblyPolicy,
  fetchProviderStreamWithTimeout,
  fetchProviderWithTimeout,
  providerEndpointHost,
  safeProviderResponseText,
  toProviderWebSocketUrl,
} from '@/modules/providers'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/modules/providers'

export const providerRoutePolicy = createProviderRouteAssemblyPolicy({
  compatibilityCapabilityCanBeSent: providerCompatibilityCapabilityCanBeSentForProvider,
})

export const providerTransport = {
  assembleRoute: providerRoutePolicy.assemble,
  resolveEndpoint: providerRoutePolicy.resolveEndpoint,
  endpointHost: providerEndpointHost,
  toWebSocketUrl: toProviderWebSocketUrl,
  request: (input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number) => fetchProviderWithTimeout(fetch, input, init, timeoutMs),
  requestStream: (input: string, init: RequestInit | undefined, timeoutMs: number) => fetchProviderStreamWithTimeout(
    (url, options) => expoFetch(url, options as never) as unknown as Promise<Response>,
    input,
    init,
    timeoutMs,
  ),
  readResponseText: safeProviderResponseText,
}
