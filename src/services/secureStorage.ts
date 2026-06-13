import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const WEB_PREFIX = '@islemind/secure/'

function webKey(key: string): string {
  return `${WEB_PREFIX}${key}`
}

export async function getSecureItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return await AsyncStorage.getItem(webKey(key))
    }
    return await SecureStore.getItemAsync(key)
  } catch {
    return null
  }
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(webKey(key), value)
      return
    }
    await SecureStore.setItemAsync(key, value)
  } catch {
    // Secure storage failure must not block the settings UI.
  }
}

export async function deleteSecureItem(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(webKey(key))
      return
    }
    await SecureStore.deleteItemAsync(key)
  } catch {
    // Secure storage failure must not block the settings UI.
  }
}
