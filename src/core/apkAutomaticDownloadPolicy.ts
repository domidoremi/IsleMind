/** Wi-Fi is an explicitly approved transport policy, not proof that a network is unmetered. */
export function canAutomaticallyPrepareApk(input: {
  enabled: boolean
  foreground: boolean | undefined
  proxyMode: string | undefined
  network: { type?: string; isConnected?: boolean; isInternetReachable?: boolean } | undefined
}): boolean {
  return input.enabled === true && input.foreground === true && input.proxyMode === 'off'
    && input.network?.type === 'WIFI' && input.network.isConnected === true
    && input.network.isInternetReachable === true
}
