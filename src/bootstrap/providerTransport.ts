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

// RN's XHR-backed global fetch does not enforce redirect policy. Expo's native
// transport does, so use the same backend for buffered and streaming requests.
const fetchProvider: typeof fetch = (input, init) =>
  expoFetch(input, init as never) as unknown as Promise<Response>

export const providerTransport = {
  assembleRoute: providerRoutePolicy.assemble,
  resolveEndpoint: providerRoutePolicy.resolveEndpoint,
  endpointHost: providerEndpointHost,
  toWebSocketUrl: toProviderWebSocketUrl,
  request: (input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number) => fetchProviderWithTimeout(fetchProvider, input, init, timeoutMs),
  requestStream: (input: string, init: RequestInit | undefined, timeoutMs: number) => fetchProviderStreamWithTimeout(
    fetchProvider,
    input,
    init,
    timeoutMs,
  ),
  readResponseText: safeProviderResponseText,
}
