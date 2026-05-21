import { useTranslation } from 'react-i18next'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { McpSettingsContent } from '@/components/settings/McpSettingsContent'

export default function McpSettingsScreen() {
  const { t } = useTranslation()
  return (
    <SettingsPageShell title={t('settings.mcp')} subtitle={t('settings.mcpDescription')}>
      <McpSettingsContent />
    </SettingsPageShell>
  )
}
