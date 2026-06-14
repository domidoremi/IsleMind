import { Text, View, useWindowDimensions } from 'react-native'
import { Layers } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import type { PageTransitionStyle } from '@/types'

const PAGE_TRANSITION_OPTIONS: { value: PageTransitionStyle; labelKey: string; descriptionKey: string }[] = [
  {
    value: 'state',
    labelKey: 'preferences.pageTransition.state',
    descriptionKey: 'preferences.pageTransition.stateDescription',
  },
  {
    value: 'classic',
    labelKey: 'preferences.pageTransition.classic',
    descriptionKey: 'preferences.pageTransition.classicDescription',
  },
]

export function PageTransitionSetting({ showHeader = true }: { showHeader?: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const settings = useSettingsStore((state) => state.settings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const activeStyle = settings.pageTransitionStyle ?? 'state'
  const compact = width < 390

  return (
    <View style={{ gap: 10 }}>
      {showHeader ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 30, height: 30, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground, borderWidth: 1, borderColor: colors.material.stroke }}>
            <Layers color={colors.ui.icon.accentForeground} size={17} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>
              {t('preferences.pageTransition')}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 3 }}>
              {t(`preferences.pageTransition.${activeStyle}Description`)}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: compact ? 'column' : 'row', flexWrap: compact ? 'nowrap' : 'wrap', gap: 8 }}>
        {PAGE_TRANSITION_OPTIONS.map((option) => {
          const active = option.value === activeStyle
          return (
            <IslePressable
              key={option.value}
              haptic
              accessibilityState={{ selected: active }}
              onPress={() => updateSettings({ pageTransitionStyle: option.value })}
              style={{
                flexGrow: 1,
                flexBasis: compact ? undefined : 142,
                minWidth: 0,
                minHeight: 58,
                borderRadius: colors.ui.radius.card,
                paddingHorizontal: 12,
                paddingVertical: 10,
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: active ? colors.ui.control.primaryBorder : colors.material.stroke,
                backgroundColor: active ? colors.ui.control.primaryBackground : colors.ui.card.defaultBackground,
              }}
            >
              <Text style={{ color: active ? colors.ui.control.primaryForeground : colors.text, fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>
                {t(option.labelKey)}
              </Text>
              <Text style={{ color: active ? colors.ui.control.primaryForeground : colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '800', marginTop: 3 }}>
                {t(option.descriptionKey)}
              </Text>
            </IslePressable>
          )
        })}
      </View>
    </View>
  )
}
