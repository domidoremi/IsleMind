import { createVerifiedSecureKeyValueStorage } from '@/core'
import { createProviderCredentialStorage } from '@/modules/providers'
import { createExpoSecureKeyValueStoragePort } from '@/platform/secureStorage'

export const KNOWN_SEARCH_SECURE_KEYS = Object.freeze([
  'islemind.key.tavily',
  'islemind.key.google-search',
  'islemind.key.bing-search',
  'islemind.key.custom-search',
] as const)
export const OBSERVABILITY_SINK_API_KEY = 'islemind.key.observability-sink'

const rawSecureKeyValueStorage = createExpoSecureKeyValueStoragePort()

export const secureKeyValueStorage = createVerifiedSecureKeyValueStorage(rawSecureKeyValueStorage)
export const providerCredentialStorage = createProviderCredentialStorage(secureKeyValueStorage)

export async function clearKnownSearchSecureKeys(): Promise<void> {
  await Promise.all(KNOWN_SEARCH_SECURE_KEYS.map((key) => secureKeyValueStorage.removeItem(key)))
}

export async function clearKnownObservabilitySecureKeys(): Promise<void> {
  await secureKeyValueStorage.removeItem(OBSERVABILITY_SINK_API_KEY)
}
