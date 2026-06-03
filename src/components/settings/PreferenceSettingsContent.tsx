import { View } from 'react-native'
import { Command, Layers, Moon, Network, Sparkles, Sun } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IsleChip, IsleField, IslePressable, IsleSection, IsleToggle } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import type { PageTransitionStyle } from '@/types'

const PAGE_TRANSITION_OPTIONS: PageTransitionStyle[] = ['state', 'classic']

export function PreferenceSettingsContent() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state.settings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  return (
    <>
      <IsleSection title={t('preferences.generation')} subtitle={t('preferences.generationSubtitle')}>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          <IsleField
            label={t('chat.temperature')}
            style={{ flex: 1 }}
            inputProps={{
              value: String(settings.defaultTemperature ?? 0.3),
              onChangeText: (value) => {
                const next = Number(value)
                if (!Number.isNaN(next)) updateSettings({ defaultTemperature: Math.max(0, Math.min(2, next)) })
              },
              keyboardType: 'numeric',
            }}
          />
          <IsleField
            label={t('chat.maxTokens')}
            style={{ flex: 1 }}
            inputProps={{
              value: settings.defaultMaxTokens ? String(settings.defaultMaxTokens) : '',
              onChangeText: (value) => {
                if (!value.trim()) {
                  updateSettings({ defaultMaxTokens: undefined })
                  return
                }
                const next = Number.parseInt(value, 10)
                if (!Number.isNaN(next)) updateSettings({ defaultMaxTokens: Math.max(128, Math.min(128000, next)) })
              },
              keyboardType: 'numeric',
              placeholder: t('preferences.followModel'),
            }}
          />
        </View>
      </IsleSection>

      <IsleToggle
        icon={settings.hapticsEnabled ? <Sun color={colors.text} size={18} /> : <Moon color={colors.text} size={18} />}
        title={t('settings.haptics')}
        active={settings.hapticsEnabled}
        onPress={() => updateSettings({ hapticsEnabled: !settings.hapticsEnabled })}
      />
      <IsleSection title={t('preferences.interaction')} style={{ marginTop: 12 }}>
        <View style={{ gap: 10 }}>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Layers color={colors.text} size={18} />
              <IsleChip active>{t('preferences.pageTransition')}</IsleChip>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PAGE_TRANSITION_OPTIONS.map((option) => (
                <IslePressable key={option} haptic onPress={() => updateSettings({ pageTransitionStyle: option })} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <IsleChip active={(settings.pageTransitionStyle ?? 'state') === option}>{t(`preferences.pageTransition.${option}`)}</IsleChip>
                </IslePressable>
              ))}
            </View>
          </View>
          <IsleToggle
            icon={<Command color={colors.text} size={18} />}
            title={t('preferences.commandPalette')}
            active={settings.commandPaletteEnabled ?? true}
            onPress={() => updateSettings({ commandPaletteEnabled: !(settings.commandPaletteEnabled ?? true) })}
          />
          <IsleToggle
            icon={<Sparkles color={colors.text} size={18} />}
            title={t('settings.skills')}
            active={settings.skillsEnabled ?? true}
            onPress={() => updateSettings({ skillsEnabled: !(settings.skillsEnabled ?? true) })}
          />
          <IsleToggle
            icon={<Network color={colors.text} size={18} />}
            title={t('settings.mcp')}
            active={settings.mcpEnabled ?? true}
            onPress={() => updateSettings({ mcpEnabled: !(settings.mcpEnabled ?? true) })}
          />
        </View>
      </IsleSection>
    </>
  )
}
