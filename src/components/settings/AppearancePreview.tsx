import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import { getColors } from '@/theme/colors'
import { fontFamilyForTheme } from '@/theme/font'
import { useSystemColorScheme } from '@/hooks/useSystemColorScheme'
import type { AppearanceSelection } from './useAppearanceDraft'

export function AppearancePreview({ selection }: { selection: AppearanceSelection }) {
  const { t } = useTranslation()
  const scheme = useSystemColorScheme()
  const colors = getColors(selection.theme, selection.themeId, scheme === 'dark' ? 'dark' : 'light', selection.themeAccent)
  const design = colors.design!
  const typography = { fontFamily: fontFamilyForTheme(selection.themeId), color: colors.text }
  return <View testID="settings-appearance-preview" accessibilityLabel={t('settings.appearancePreview')}
    style={[styles.frame, { borderRadius: design.semantic.radius.large, borderColor: colors.ui.semantic.chrome.border, backgroundColor: colors.ui.semantic.surface.base }]}>
    <View style={[styles.header, { backgroundColor: colors.ui.semantic.chrome.background, borderBottomColor: colors.ui.semantic.chrome.border }]}>
      <Text style={[styles.title, typography]}>IsleMind</Text>
      <Text style={[styles.caption, typography, { color: colors.textSecondary }]}>{t('settings.appearancePreview')}</Text>
    </View>
    <View style={styles.content}>
      <View style={[styles.message, { borderRadius: colors.ui.radius.card, backgroundColor: colors.ui.semantic.surface.muted }]}>
        <Text style={[styles.body, typography]}>{t('settings.appearancePreviewSample')}</Text>
      </View>
      <View style={[styles.input, { borderRadius: colors.ui.radius.controlLarge, backgroundColor: colors.ui.input.background, borderColor: colors.ui.input.border }]}>
        <Text style={[styles.body, typography, { flex: 1, minWidth: 0, color: colors.ui.input.placeholderForeground }]}>{t('settings.appearancePreviewInput')}</Text>
        <View accessible={false} style={[styles.accent, { borderRadius: colors.ui.radius.controlSmall, backgroundColor: colors.ui.control.primaryBackground }]}>
          <Text style={[styles.body, typography, { color: colors.ui.control.primaryForeground }]}>+</Text>
        </View>
      </View>
    </View>
  </View>
}

const styles = StyleSheet.create({
  frame: { minWidth: 0, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  caption: { fontSize: 12, lineHeight: 18, marginLeft: 'auto' },
  content: { padding: 14, gap: 12 },
  message: { padding: 12, alignSelf: 'flex-start', maxWidth: '92%' },
  body: { fontSize: 14, lineHeight: 22 },
  input: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  accent: { minWidth: 32, minHeight: 32, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
})
