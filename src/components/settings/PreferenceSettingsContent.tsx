import { View } from 'react-native'
import { Command, Moon, Network, Sparkles, Sun } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IslandField, IslandSection, IslandToggle } from '@/components/ui/IslandPrimitives'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'

export function PreferenceSettingsContent() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state.settings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  return (
    <>
      <IslandSection title={t('preferences.generation')} subtitle={t('preferences.generationSubtitle')}>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          <IslandField
            label={t('chat.temperature')}
            style={{ flex: 1 }}
            inputProps={{
              value: String(settings.defaultTemperature ?? 0.7),
              onChangeText: (value) => {
                const next = Number(value)
                if (!Number.isNaN(next)) updateSettings({ defaultTemperature: Math.max(0, Math.min(2, next)) })
              },
              keyboardType: 'numeric',
            }}
          />
          <IslandField
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
      </IslandSection>

      <IslandToggle
        icon={settings.hapticsEnabled ? <Sun color={colors.text} size={18} /> : <Moon color={colors.text} size={18} />}
        title={t('settings.haptics')}
        active={settings.hapticsEnabled}
        onPress={() => updateSettings({ hapticsEnabled: !settings.hapticsEnabled })}
      />
      <IslandSection title={t('preferences.interaction')} style={{ marginTop: 12 }}>
        <View style={{ gap: 10 }}>
          <IslandToggle
            icon={<Command color={colors.text} size={18} />}
            title={t('preferences.commandPalette')}
            active={settings.commandPaletteEnabled ?? true}
            onPress={() => updateSettings({ commandPaletteEnabled: !(settings.commandPaletteEnabled ?? true) })}
          />
          <IslandToggle
            icon={<Sparkles color={colors.text} size={18} />}
            title={t('settings.skills')}
            active={settings.skillsEnabled ?? true}
            onPress={() => updateSettings({ skillsEnabled: !(settings.skillsEnabled ?? true) })}
          />
          <IslandToggle
            icon={<Network color={colors.text} size={18} />}
            title={t('settings.mcp')}
            active={settings.mcpEnabled ?? true}
            onPress={() => updateSettings({ mcpEnabled: !(settings.mcpEnabled ?? true) })}
          />
        </View>
      </IslandSection>
    </>
  )
}
