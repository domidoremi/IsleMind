import { Platform } from 'react-native'

export const shouldUseSqliteWebFallback = Platform.OS === 'web'

export const sqliteWebFallbackDb = {
  execAsync: async () => undefined,
  runAsync: async () => undefined,
  getAllAsync: async <T>() => [] as T[],
  getFirstAsync: async <T>() => null as T | null,
}
