import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { IsleButton } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { normalizeSettingsToolDeclarationMode } from '@/modules/settings'
import { MODEL_OPERATION_DIRECT_DECLARATION_COUNT, MODEL_OPERATION_DECLARATION_TARGET_CHARS } from '@/modules/integrations'
import { WorkspaceTabs } from '@/presentation/layout/WorkspaceTabs'
import { SettingsFieldReceipt, type useSettingsFieldSession } from './SettingsFieldSession'
import { SettingsHelpButton } from './SettingsHelp'
import type { ToolDeclarationMode } from '@/types/settingsContracts'

/** A page-owned field session preserves its draft through task navigation and theme changes. */
export function ToolDeclarationSettings({ session }: { session: ReturnType<typeof useSettingsFieldSession> }) {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const settings = useSettingsStore(state => state.settings)
  const updateSettings = useSettingsStore(state => state.updateSettings)
  const saved = normalizeSettingsToolDeclarationMode(settings.toolDeclarationMode)
  const entry = session.entries.toolDeclarationMode
  const value = normalizeSettingsToolDeclarationMode(entry?.draft ?? saved)
  return <View testID="settings-tool-declarations" style={{ gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 21, fontWeight: '700' }}>
        {t('toolDeclarations.modeLabel')}
      </Text>
      <SettingsFieldReceipt session={session} settingKey="toolDeclarationMode" />
      <SettingsHelpButton topic="tools" />
    </View>
    <WorkspaceTabs<ToolDeclarationMode> testID="settings-tool-declaration-mode" role="radio"
      accessibilityLabel={t('toolDeclarations.title')} value={value} disabled={session.busy}
      tabs={[{ value: 'full', label: t('toolDeclarations.full') }, { value: 'auto', label: t('toolDeclarations.auto') }]}
      onChange={mode => session.edit('toolDeclarationMode', mode, saved)} />
    <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
      {t(value === 'auto' ? 'toolDeclarations.autoHint' : 'toolDeclarations.fullHint', {
        count: MODEL_OPERATION_DIRECT_DECLARATION_COUNT,
        chars: MODEL_OPERATION_DECLARATION_TARGET_CHARS.toLocaleString(i18n.language),
      })}
    </Text>
    <Text style={{ color: colors.textTertiary, fontSize: 13, lineHeight: 20 }}>{t('toolDeclarations.scope')}</Text>
    {entry?.error ? <Text accessibilityRole="alert" style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, lineHeight: 21 }}>
      {t(`settingsWorkspace.${entry.error}`)}
    </Text> : null}
    {entry ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <IsleButton label={t('settingsWorkspace.save')} disabled={session.busy} busy={session.savingKey === 'toolDeclarationMode'}
        feedbackPhase={session.savingKey === 'toolDeclarationMode' ? 'pending' : 'idle'}
        icon={<AppIcon name="check" size={16} color={colors.text} />}
        onPress={() => void session.save('toolDeclarationMode',
          mode => updateSettings({ toolDeclarationMode: normalizeSettingsToolDeclarationMode(mode) }),
          normalizeSettingsToolDeclarationMode)} />
      <IsleButton label={t('settingsWorkspace.reload')} disabled={session.busy} onPress={() => session.discard('toolDeclarationMode')} />
    </View> : null}
  </View>
}
