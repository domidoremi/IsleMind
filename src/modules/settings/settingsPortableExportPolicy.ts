import { sanitizeProviderPortableExportUrl } from '@/modules/providers'
import type { Settings } from '@/types/settingsContracts'
import { normalizeSettingsIdentityPreferences } from './identity'

type PortableSettingsUrlField =
  | 'customSearchEndpoint'
  | 'localModelDownloadMirrorBaseUrl'
  | 'observabilitySinkEndpointUrl'
  | 'proxyBaseUrl'

const PORTABLE_SETTINGS_URL_FIELDS: readonly PortableSettingsUrlField[] = [
  'customSearchEndpoint',
  'localModelDownloadMirrorBaseUrl',
  'observabilitySinkEndpointUrl',
  'proxyBaseUrl',
]

export function sanitizeSettingsForPortableExport(settings: Settings): Settings {
  const normalizedIdentity = normalizeSettingsIdentityPreferences({
    ...settings,
    // Current settings snapshots explicitly carry an empty collection, while
    // older imports that omit the field can preserve a selective target.
    modelFavorites: settings.modelFavorites ?? [],
    modelRoutingPlans: settings.modelRoutingPlans ?? [],
    scenePlans: settings.scenePlans ?? [],
  })
  let sanitized: Settings | undefined = normalizedIdentity === settings ? undefined : normalizedIdentity
  for (const field of PORTABLE_SETTINGS_URL_FIELDS) {
    const nextValue = sanitizeProviderPortableExportUrl(normalizedIdentity[field]) ?? ''
    if (normalizedIdentity[field] === nextValue) continue
    sanitized ??= { ...normalizedIdentity }
    sanitized[field] = nextValue
  }
  return sanitized ?? normalizedIdentity
}
