import { canAutomaticallyPrepareApk } from './apkAutomaticDownloadPolicy'

const policy = { enabled: true, foreground: true, proxyMode: 'off',
  network: { type: 'WIFI', isConnected: true, isInternetReachable: true } }
it('requires explicit Wi-Fi policy approval and positively known connectivity', () => {
  expect(canAutomaticallyPrepareApk(policy)).toBe(true)
  expect(canAutomaticallyPrepareApk({ ...policy, enabled: false })).toBe(false)
  expect(canAutomaticallyPrepareApk({ ...policy, foreground: undefined })).toBe(false)
  expect(canAutomaticallyPrepareApk({ ...policy, network: undefined })).toBe(false)
})
it.each(['CELLULAR', 'VPN', 'UNKNOWN', 'NONE', undefined])('refuses %s networks', (type) => {
  expect(canAutomaticallyPrepareApk({ ...policy, network: { ...policy.network, type } })).toBe(false)
})
it.each(['http', 'socks', undefined])('refuses configured or unknown proxy state %s', (proxyMode) => {
  expect(canAutomaticallyPrepareApk({ ...policy, proxyMode })).toBe(false)
})
it.each([false, undefined])('refuses incomplete reachability %s', (isInternetReachable) => {
  expect(canAutomaticallyPrepareApk({ ...policy, network: { ...policy.network, isInternetReachable } })).toBe(false)
})
