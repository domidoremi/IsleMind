import { useLocalSearchParams } from 'expo-router'
import { createLazyComponent } from '@/utils/lazyLoad'
import type { SettingsControlPanel } from '@/presentation/features/settings/settingsControlNavigation'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { Text } from 'react-native'
import { useTranslation } from 'react-i18next'
const Content = createLazyComponent(() => import('@/components/settings/SystemSettingsPanelContent').then(module => ({ default: module.SystemSettingsPanelContent })))
const panels = ['appearance', 'data', 'advanced', 'diagnostics', 'governance', 'updates', 'danger']
export default function SystemSettingsScreen() {
  const { panel } = useLocalSearchParams<{ panel: string }>()
  const { t } = useTranslation()
  if (!panels.includes(panel)) return <SettingsPageShell title={t('settings.title')}><Text>{t('settings.controlSearchEmpty')}</Text></SettingsPageShell>
  return <Content key={panel} panel={panel as SettingsControlPanel} />
}
