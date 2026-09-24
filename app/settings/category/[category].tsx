import { useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Text } from 'react-native'
import { SettingsNavigationContent } from '@/components/settings/SettingsNavigationContent'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { SETTINGS_CATEGORIES, type SettingsCategory } from '@/presentation/features/settings/settingsRegistry'
export default function SettingsCategoryScreen() {
  const { category } = useLocalSearchParams<{ category: string }>()
  const { t } = useTranslation()
  const valid = SETTINGS_CATEGORIES.includes(category as SettingsCategory)
  return <SettingsPageShell title={t(valid ? `settingsWorkspace.categories.${category}` : 'settings.title')} scrollable={false}>
    {valid ? <SettingsNavigationContent category={category as SettingsCategory} /> : <Text>{t('settings.controlSearchEmpty')}</Text>}
  </SettingsPageShell>
}
