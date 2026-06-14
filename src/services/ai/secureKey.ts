import { deleteSecureItem, getSecureItem, setSecureItem } from '@/services/secureStorage'

function secureProviderKey(providerId: string): string {
  return `islemind.key.${providerId.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

function secureProviderGroupKey(providerId: string, groupId: string): string {
  return `islemind.key.${providerId.replace(/[^a-zA-Z0-9._-]/g, '_')}.${groupId.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

export async function getSecureApiKey(providerId: string): Promise<string | null> {
  try {
    return await getSecureItem(secureProviderKey(providerId))
  } catch {
    return null
  }
}

export async function getSecureCredentialGroupKey(providerId: string, groupId: string): Promise<string | null> {
  try {
    return await getSecureItem(secureProviderGroupKey(providerId, groupId))
  } catch {
    return null
  }
}

export async function setSecureCredentialGroupKey(providerId: string, groupId: string, key: string): Promise<void> {
  try {
    if (key) {
      await setSecureItem(secureProviderGroupKey(providerId, groupId), key)
    } else {
      await deleteSecureItem(secureProviderGroupKey(providerId, groupId))
    }
  } catch {
    // silently fail
  }
}

export async function deleteSecureCredentialGroupKey(providerId: string, groupId: string): Promise<void> {
  try {
    await deleteSecureItem(secureProviderGroupKey(providerId, groupId))
  } catch {
    // silently fail
  }
}

export async function setSecureApiKey(providerId: string, key: string): Promise<void> {
  try {
    if (key) {
      await setSecureItem(secureProviderKey(providerId), key)
    } else {
      await deleteSecureItem(secureProviderKey(providerId))
    }
  } catch {
    // silently fail
  }
}

export async function deleteSecureApiKey(providerId: string): Promise<void> {
  try {
    await deleteSecureItem(secureProviderKey(providerId))
  } catch {
    // silently fail
  }
}
