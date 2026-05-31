import { useLocalSearchParams } from 'expo-router'
import { ContextPanel } from '@/components/settings/ContextPanel'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { useSettingsStore } from '@/store/settingsStore'
import { useTranslation } from 'react-i18next'

export default function MemorySettingsScreen() {
  const { t } = useTranslation()
  const providers = useSettingsStore((state) => state.providers)
  const params = useLocalSearchParams<{ focus?: string }>()
  const focus = params.focus === 'review' ? 'review' : undefined
  return (
    <SettingsPageShell title={t('settings.memory')} subtitle={t('settings.memoryDescription')} focusKey={params.focus}>
      <ContextPanel providers={providers} section="memory" focus={focus} />
    </SettingsPageShell>
  )
}
