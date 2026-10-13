import Constants from 'expo-constants'
import { nativeApplicationVersion } from 'expo-application'
import { randomUUID } from 'expo-crypto'
import { fetch as expoFetch } from 'expo/fetch'
import { createHttpContentReporting } from '@/modules/conversations'
import sourceAppConfig from '../../app.json'

export const contentReporting = createHttpContentReporting({
  configuration: Constants.expoConfig?.extra?.contentReporting,
  appVersion: nativeApplicationVersion ?? sourceAppConfig.expo.version,
  randomUUID,
  // Unlike RN's XHR global fetch, Expo fetch enforces redirect:error on native.
  fetch: (url, init) => expoFetch(url, init as never) as unknown as Promise<Response>,
})
