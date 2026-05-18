import * as SecureStore from 'expo-secure-store'

function secureProviderKey(providerId: string): string {
  return `islemind.key.${providerId.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

function secureProviderGroupKey(providerId: string, groupId: string): string {
  return `islemind.key.${providerId.replace(/[^a-zA-Z0-9._-]/g, '_')}.${groupId.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

export async function getSecureApiKey(providerId: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(secureProviderKey(providerId))
  } catch {
    return null
  }
}

export async function getSecureCredentialGroupKey(providerId: string, groupId: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(secureProviderGroupKey(providerId, groupId))
  } catch {
    return null
  }
}

export async function setSecureCredentialGroupKey(providerId: string, groupId: string, key: string): Promise<void> {
  try {
    if (key) {
      await SecureStore.setItemAsync(secureProviderGroupKey(providerId, groupId), key)
    } else {
      await SecureStore.deleteItemAsync(secureProviderGroupKey(providerId, groupId))
    }
  } catch {
    // silently fail
  }
}

export async function deleteSecureCredentialGroupKey(providerId: string, groupId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(secureProviderGroupKey(providerId, groupId))
  } catch {
    // silently fail
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
