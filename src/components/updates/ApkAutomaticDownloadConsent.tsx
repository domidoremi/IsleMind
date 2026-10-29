import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { Text } from '@/components/ui/AppText'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

const DOWNLOAD_CONDITIONS = [
  { icon: 'device', label: 'updates.autoDownloadForeground' },
  { icon: 'network', label: 'updates.autoDownloadWifi' },
  { icon: 'settings-sliders', label: 'updates.autoDownloadProxyOff' },
] as const

export function ApkAutomaticDownloadConsent() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  return (
    <View testID="apk-auto-download-consent" style={{ width: '100%', gap: 16 }}>
      <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20, fontWeight: '600' }}>
          {t('updates.autoDownloadConditions')}
        </Text>
        {DOWNLOAD_CONDITIONS.map(({ icon, label }) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ width: 20, minHeight: 21, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <AppIcon name={icon} color={colors.textSecondary} size={18} />
            </View>
            <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 21 }}>{t(label)}</Text>
          </View>
        ))}
      </View>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.semantic.chrome.border, paddingTop: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 20, minHeight: 21, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <AppIcon name="lock" color={colors.textSecondary} size={18} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 14, lineHeight: 21, fontWeight: '700' }}>
            {t('updates.autoDownloadInstallBoundary')}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{t('updates.autoDownloadInstallDetail')}</Text>
        </View>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: 13, lineHeight: 20 }}>
          {t('updates.autoDownloadMeteredWarning')}
        </Text>
        <IslePressable
          testID="apk-auto-download-details-toggle"
          accessibilityRole="button"
          accessibilityLabel={t('updates.autoDownloadDetails')}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(value => !value)}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
        >
          <Text style={{ flex: 1, minWidth: 0, color: colors.primary, fontSize: 13, lineHeight: 20, fontWeight: '600' }}>
            {t('updates.autoDownloadDetails')}
          </Text>
          <View style={{ flexShrink: 0, transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
            <AppIcon name="collapse" color={colors.primary} size={16} />
          </View>
        </IslePressable>
        {expanded ? (
          <View testID="apk-auto-download-details" style={{ gap: 8 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{t('updates.autoDownloadNetworkDetail')}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{t('updates.autoDownloadControlDetail')}</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}
