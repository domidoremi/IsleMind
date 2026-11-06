import type { AIProvider } from '@/types/providerContracts'
import { getProviderGatewayInfo, isProviderNetworkBlocked } from './providerGateway'

const provider = (baseUrl: string): AIProvider => ({
  id: 'local', name: 'Local', type: 'openai-compatible', enabled: true, apiKey: '', baseUrl, models: [],
})

it.each([
  'http://10.0.0.133:3425/v1', 'http://192.168.1.10/v1', 'https://172.16.0.1/v1',
  'http://172.31.255.254/v1', 'http://169.254.1.2/v1', 'http://desktop.local:3425/v1',
  'http://desktop.lan/v1', 'http://desktop.home.arpa/v1', 'http://desktop:3425/v1',
  'http://[fd12:3456::1]:3425/v1', 'http://[febf::1]:3425/v1',
])('allows the local connection %s when Wi-Fi has no internet', baseUrl => {
  expect(getProviderGatewayInfo(provider(baseUrl))).toMatchObject({ local: true, loopback: false })
  expect(isProviderNetworkBlocked(provider(baseUrl), { isConnected: true, isInternetReachable: false })).toBe(false)
  expect(isProviderNetworkBlocked(provider(baseUrl), { isConnected: false, isInternetReachable: false })).toBe(true)
})

it.each(['http://localhost:3425/v1', 'http://127.0.0.1:3425/v1', 'http://[::1]:3425/v1'])(
  'can attempt an on-device or forwarded connection %s without Wi-Fi', baseUrl => {
    expect(getProviderGatewayInfo(provider(baseUrl))).toMatchObject({ local: true, loopback: true })
    expect(isProviderNetworkBlocked(provider(baseUrl), { isConnected: false, isInternetReachable: false })).toBe(false)
  },
)

it.each(['https://api.example.com/v1', 'http://172.32.0.1/v1', 'http://192.167.0.1/v1', 'http://[2001:db8::1]/v1'])(
  'keeps internet checks for %s', baseUrl => {
    expect(getProviderGatewayInfo(provider(baseUrl))).toBeUndefined()
    expect(isProviderNetworkBlocked(provider(baseUrl), { isConnected: true, isInternetReachable: false })).toBe(true)
    expect(isProviderNetworkBlocked(provider(baseUrl), {})).toBe(false)
  },
)

it('does not classify invalid addresses or credentials embedded in an address as usable gateways', () => {
  for (const baseUrl of ['not a URL', 'file://localhost/path', 'http://name:password@localhost:3425/v1']) {
    expect(getProviderGatewayInfo(provider(baseUrl))).toBeUndefined()
  }
})
