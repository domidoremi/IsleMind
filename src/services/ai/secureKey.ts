import * as SecureStore from 'expo-secure-store'

function secureProviderKey(providerId: string): string {
  return `islemind.key.${providerId.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

export async function getSecureApiKey(providerId: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(secureProviderKey(providerId))
  } catch {
    return null
  }
}

export async function setSecureApiKey(providerId: string, key: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(secureProviderKey(providerId), key)
  } catch {
    // silently fail
  }
}

export async function deleteSecureApiKey(providerId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(secureProviderKey(providerId))
  } catch {
    // silently fail
  }
}
