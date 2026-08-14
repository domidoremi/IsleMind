import type { Settings } from '@/types/settingsContracts'
import { safeHttpUrl } from '@/utils/networkUrlSafety'

type UrlBackedSettingsField =
  | 'customSearchEndpoint'
  | 'localModelDownloadMirrorBaseUrl'
  | 'proxyBaseUrl'
  | 'observabilitySinkEndpointUrl'

const URL_BACKED_SETTINGS_FIELDS: readonly UrlBackedSettingsField[] = [
  'customSearchEndpoint',
  'localModelDownloadMirrorBaseUrl',
  'observabilitySinkEndpointUrl',
  'proxyBaseUrl',
]

export function sanitizeSettingsUrlFields(settings: Settings): Settings {
  let updated: Settings | null = null
  for (const field of URL_BACKED_SETTINGS_FIELDS) {
    const nextValue = sanitizeSettingsUrlField(settings[field])
    if (settings[field] === nextValue) continue
    updated = updated ?? { ...settings }
    updated[field] = nextValue
  }
  return updated ?? settings
}

function sanitizeSettingsUrlField(value: string | undefined): string {
  return safeHttpUrl(value) ?? ''
}
