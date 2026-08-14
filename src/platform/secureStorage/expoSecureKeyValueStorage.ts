import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import type { SecureKeyValueStoragePort } from '@/core'

export const SECURE_STORAGE_WEB_KEY_PREFIX = '@islemind/secure/'

function webKey(key: string): string {
  return `${SECURE_STORAGE_WEB_KEY_PREFIX}${key}`
}

/** Platform adapter only. Failure projection and mutation verification live in Core. */
export function createExpoSecureKeyValueStoragePort(): SecureKeyValueStoragePort {
  return Object.freeze({
    getItem(key: string) {
      return Platform.OS === 'web'
        ? AsyncStorage.getItem(webKey(key))
        : SecureStore.getItemAsync(key)
    },
    async setItem(key: string, value: string) {
      if (Platform.OS === 'web') {
        await AsyncStorage.setItem(webKey(key), value)
        return
      }
      await SecureStore.setItemAsync(key, value)
    },
    async removeItem(key: string) {
      if (Platform.OS === 'web') {
        await AsyncStorage.removeItem(webKey(key))
        return
      }
      await SecureStore.deleteItemAsync(key)
    },
  })
}
