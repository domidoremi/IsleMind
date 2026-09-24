import Constants from 'expo-constants'

/** Build-time rollback gate, not model/Skill/import-controlled authorization. */
export function agentHarnessNewRunsEnabled(): boolean {
  return Constants.expoConfig?.extra?.agentHarnessEnabled !== false
}
