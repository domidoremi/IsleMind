import { View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { IsleField, IsleSection, IsleToggle } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { clampProviderPlatformOutputTokens, clampProviderPlatformTemperature } from '@/services/ai/providerParameterDefaults'
import { useSettingsStore } from '@/store/settingsStore'

export function PreferenceSettingsContent() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state.settings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const { width } = useWindowDimensions()
  const compact = width < 430
  const fieldRowStyle = { flexDirection: compact ? 'column' : 'row', gap: 10, marginBottom: 12 } as const
  const fieldFlexStyle = compact ? undefined : { flex: 1, minWidth: 0 }
  const updateBoundedNumberSetting = (
    key: 'agentWorkflowMaxSteps' | 'agentWorkflowMaxToolCallsPerStep' | 'agentWorkflowOutputCharLimit',
    value: string,
    min: number,
    max: number
  ) => {
    const next = Number.parseInt(value, 10)
    if (!Number.isNaN(next)) updateSettings({ [key]: Math.max(min, Math.min(max, next)) })
  }

  return (
    <>
      <IsleSection title={t('preferences.generation')} subtitle={t('preferences.generationSubtitle')}>
        <View style={fieldRowStyle}>
          <IsleField
            label={t('chat.temperature')}
            style={fieldFlexStyle}
            inputProps={{
              value: settings.defaultTemperature === undefined ? '' : String(settings.defaultTemperature),
              onChangeText: (value) => {
                if (!value.trim()) {
                  updateSettings({ defaultTemperature: undefined })
                  return
                }
                const next = Number(value)
                if (!Number.isNaN(next)) updateSettings({ defaultTemperature: clampProviderPlatformTemperature(next) })
              },
              keyboardType: 'numeric',
              placeholder: t('preferences.followModel'),
            }}
          />
          <IsleField
            label={t('chat.maxTokens')}
            style={fieldFlexStyle}
            inputProps={{
              value: settings.defaultMaxTokens ? String(settings.defaultMaxTokens) : '',
              onChangeText: (value) => {
                if (!value.trim()) {
                  updateSettings({ defaultMaxTokens: undefined })
                  return
                }
                const next = Number.parseInt(value, 10)
                if (!Number.isNaN(next)) updateSettings({ defaultMaxTokens: clampProviderPlatformOutputTokens(next) })
              },
              keyboardType: 'numeric',
              placeholder: t('preferences.followModel'),
            }}
          />
        </View>
      </IsleSection>

      <IsleToggle
        icon={settings.hapticsEnabled ? <AppIcon name="sun" color={colors.text} size={18} /> : <AppIcon name="moon" color={colors.text} size={18} />}
        title={t('settings.haptics')}
        active={settings.hapticsEnabled}
        onPress={() => updateSettings({ hapticsEnabled: !settings.hapticsEnabled })}
      />
      <IsleSection title={t('preferences.interaction')} style={{ marginTop: 12 }}>
        <View style={{ gap: 10 }}>
          <IsleToggle
            icon={<AppIcon name="command" color={colors.text} size={18} />}
            title={t('preferences.commandPalette')}
            active={settings.commandPaletteEnabled ?? true}
            onPress={() => updateSettings({ commandPaletteEnabled: !(settings.commandPaletteEnabled ?? true) })}
          />
          <IsleToggle
            icon={<AppIcon name="spark" color={colors.text} size={18} />}
            title={t('settings.skills')}
            active={settings.skillsEnabled ?? true}
            onPress={() => updateSettings({ skillsEnabled: !(settings.skillsEnabled ?? true) })}
          />
          <IsleToggle
            icon={<AppIcon name="network" color={colors.text} size={18} />}
            title={t('settings.mcp')}
            active={settings.mcpEnabled ?? true}
            onPress={() => updateSettings({ mcpEnabled: !(settings.mcpEnabled ?? true) })}
          />
        </View>
      </IsleSection>

      <IsleSection title={t('preferences.agentWorkflow')} subtitle={t('preferences.agentWorkflowSubtitle')} style={{ marginTop: 12 }}>
        <View style={fieldRowStyle}>
          <IsleField
            label={t('preferences.agentWorkflowMaxSteps')}
            note={t('preferences.agentWorkflowMaxStepsNote')}
            style={fieldFlexStyle}
            inputProps={{
              value: String(settings.agentWorkflowMaxSteps ?? 3),
              onChangeText: (value) => updateBoundedNumberSetting('agentWorkflowMaxSteps', value, 1, 8),
              keyboardType: 'numeric',
            }}
          />
          <IsleField
            label={t('preferences.agentWorkflowMaxToolCalls')}
            note={t('preferences.agentWorkflowMaxToolCallsNote')}
            style={fieldFlexStyle}
            inputProps={{
              value: String(settings.agentWorkflowMaxToolCallsPerStep ?? 1),
              onChangeText: (value) => updateBoundedNumberSetting('agentWorkflowMaxToolCallsPerStep', value, 1, 3),
              keyboardType: 'numeric',
            }}
          />
        </View>
        <IsleField
          label={t('preferences.agentWorkflowOutputLimit')}
          note={t('preferences.agentWorkflowOutputLimitNote')}
          inputProps={{
            value: String(settings.agentWorkflowOutputCharLimit ?? 4800),
            onChangeText: (value) => updateBoundedNumberSetting('agentWorkflowOutputCharLimit', value, 512, 12000),
            keyboardType: 'numeric',
          }}
        />
        <View style={{ gap: 10, marginTop: 12 }}>
          <IsleToggle
            icon={<AppIcon name="shield" color={colors.text} size={18} />}
            title={t('preferences.agentWorkflowReadOnlyTools')}
            description={t('preferences.agentWorkflowReadOnlyToolsDescription')}
            active={settings.agentWorkflowAllowReadOnlyTools ?? true}
            onPress={() => updateSettings({ agentWorkflowAllowReadOnlyTools: !(settings.agentWorkflowAllowReadOnlyTools ?? true) })}
          />
          <IsleToggle
            icon={<AppIcon name="shield" color={colors.text} size={18} />}
            title={t('preferences.agentWorkflowVisibleWrites')}
            description={t('preferences.agentWorkflowVisibleWritesDescription')}
            active={(settings.agentWorkflowAllowReadWriteTools ?? 'visible') !== false}
            onPress={() => updateSettings({ agentWorkflowAllowReadWriteTools: (settings.agentWorkflowAllowReadWriteTools ?? 'visible') === false ? 'visible' : false })}
          />
          <IsleToggle
            icon={<AppIcon name="shield" color={colors.text} size={18} />}
            title={t('preferences.agentWorkflowDestructiveConfirm')}
            description={t('preferences.agentWorkflowDestructiveConfirmDescription')}
            active={(settings.agentWorkflowAllowDestructiveTools ?? 'confirm') === 'confirm'}
            onPress={() => updateSettings({ agentWorkflowAllowDestructiveTools: (settings.agentWorkflowAllowDestructiveTools ?? 'confirm') === 'confirm' ? false : 'confirm' })}
          />
        </View>
      </IsleSection>
    </>
  )
}
