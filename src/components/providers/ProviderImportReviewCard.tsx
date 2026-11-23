import { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { hasCredentialModelCatalog, normalizeProviderCredentialGroups, providerSettingsEndpointOrigin } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'

export function ProviderImportReviewCard({ provider, protocolLabel }: { provider: AIProvider; protocolLabel: string }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const [keyLimit, setKeyLimit] = useState(3)
  const groups = normalizeProviderCredentialGroups(provider, { messages: {
    defaultToken: t('apiKeyPanel.groupName', { index: 1 }),
    groupName: index => t('apiKeyPanel.groupName', { index }),
  } }).credentialGroups ?? []
  const enabled = groups.filter(group => group.enabled).length
  const models = [...new Set([...provider.models, ...(provider.manualModels ?? [])])]
  const selected = provider.enabledModels === undefined ? models.length : models.filter(model => provider.enabledModels?.includes(model)).length
  const endpoint = providerSettingsEndpointOrigin(provider)
  return <View testID="provider-import-connection-review" style={{ gap: 6, paddingVertical: 10 }}>
    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{provider.name}</Text>
    <Text style={{ color: colors.textSecondary }}>{endpoint ?? t('providerSettings.baseUrl')}</Text>
    <Text style={{ color: colors.textSecondary }}>{protocolLabel}</Text>
    <Text style={{ color: colors.textSecondary }}>{t('apiKeyPanel.modelsSelectedCount', { selected, total: models.length })}</Text>
    {models.length ? <Text style={{ color: colors.textSecondary }}>{models.slice(0, 3).join(', ')}</Text> : null}
    <Text style={{ color: colors.textSecondary }}>{t('providerSettings.importCredentialSummary', { count: groups.length })}</Text>
    <Text style={{ color: colors.textSecondary }}>{t('providerSettings.importCredentialState', { enabled, disabled: groups.length - enabled })}</Text>
    {provider.credentialSelection ? <Text style={{ color: colors.textSecondary }}>{t(`apiKeyPanel.credentialStrategies.${provider.credentialSelection.strategy}`)}</Text> : null}
    {groups.slice(0, keyLimit).map(group => <View key={group.id} testID="provider-import-key-review" style={{ gap: 3, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{group.label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Text style={{ color: colors.textSecondary }}>{t(group.enabled ? 'apiKeyPanel.enabledState' : 'apiKeyPanel.disabledState')}</Text>
        {provider.credentialSelection?.preferredGroupId === group.id ? <Text style={{ color: colors.primary }}>{t('apiKeyPanel.preferredCredential')}</Text> : null}
        <Text style={{ color: colors.textSecondary }}>{hasCredentialModelCatalog(group)
          ? t('apiKeyPanel.modelCount', { count: group.availableModels?.length ?? 0 })
          : t('providerSettings.importCatalogUnknown')}</Text>
      </View>
    </View>)}
    {groups.length > keyLimit ? <IsleButton label={t('providerSettings.importShowMoreKeys')} onPress={() => setKeyLimit(value => value + 8)} /> : null}
  </View>
}
