import Constants from 'expo-constants'
import { Linking } from 'react-native'
import sourceAppConfig from '../../../app.json'

// This is embedded by app.config.js, not a user preference or installer heuristic.
// Missing metadata remains compatible with existing direct-distribution APKs.
export function isGooglePlayDistribution(): boolean {
  return Constants.expoConfig?.extra?.distributionChannel === 'google-play'
}

export function openGooglePlayListing(): Promise<void> {
  const packageName = sourceAppConfig.expo.android.package
  return Linking.openURL(`https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`)
}
