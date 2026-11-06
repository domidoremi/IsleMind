import type { AIProvider } from '@/types/providerContracts'

export type ProviderNetworkState = { isConnected?: boolean | null; isInternetReachable?: boolean | null }

/** Address classification only. Connection success comes from an actual network operation. */
export function getProviderGatewayInfo(provider: Pick<AIProvider, 'baseUrl' | 'modelConfigs'> | undefined) {
  if (!provider?.baseUrl) return undefined
  try {
    const url = new URL(provider.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const ipv4 = host.split('.').map(Number)
    const validIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) && ipv4.every(part => part >= 0 && part <= 255)
    const loopback = host === 'localhost' || host === '::1' || validIPv4 && ipv4[0] === 127
    const local = loopback || validIPv4 && (ipv4[0] === 10 || ipv4[0] === 192 && ipv4[1] === 168
      || ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31 || ipv4[0] === 169 && ipv4[1] === 254)
      || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa')
      || !host.includes('.') && !host.includes(':')
      || /^f[cd][\da-f]{2}:|^fe[89ab][\da-f]:/i.test(host)
    const magpie = provider.modelConfigs?.some(model => Boolean(model.upstreamProvider)) ?? false
    if (!local && !magpie) return undefined
    return { kind: magpie ? 'magpie' as const : 'lan' as const, local, loopback, host }
  } catch {
    return undefined
  }
}

export function isProviderNetworkBlocked(provider: AIProvider | undefined, network: ProviderNetworkState) {
  const gateway = getProviderGatewayInfo(provider)
  // An on-device service or an ADB-reversed port can work without Wi-Fi.
  if (gateway?.loopback) return false
  if (network.isConnected === false) return true
  return network.isInternetReachable === false && !gateway?.local
}
