import Constants from 'expo-constants'

// This is embedded by app.config.js, not a user preference or installer heuristic.
// Missing metadata remains compatible with existing direct-distribution APKs.
export function isGooglePlayDistribution(): boolean {
  return Constants.expoConfig?.extra?.distributionChannel === 'google-play'
}
