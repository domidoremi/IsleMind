import { useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { IsleButton, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import type { ActionFeedbackPhase } from '@/hooks/useActionFeedback'

export function DocumentEditorToolbar({ preview, onPreviewChange, copyPhase, onCopy }: {
  preview: boolean
  onPreviewChange: (preview: boolean) => void
  copyPhase: ActionFeedbackPhase
  onCopy: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width, fontScale } = useWindowDimensions()
  const motion = useThemeMotion('accent', { readable: true })
  const [tabsWidth, setTabsWidth] = useState(0)
  const typography = colors.design!.semantic.typography
  const stacked = width / fontScale < 300
  return <View testID="document-editor-toolbar" style={[styles.toolbar, stacked && styles.stackedToolbar]}>
    <View accessibilityRole="tablist" style={[styles.tabs, stacked && styles.stackedTabs, { backgroundColor: colors.design?.semantic.color.surfaceContainer ?? colors.ui.semantic.surface.muted }]}
      onLayout={event => setTabsWidth(event.nativeEvent.layout.width)}>
      <MotiView pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        animate={{ translateX: preview ? tabsWidth / 2 : 0 }} transition={motion.intensity === 'full' ? motion.transition : { type: 'timing', duration: 1 }}
        style={[styles.selection, { backgroundColor: colors.ui.semantic.surface.raised, borderColor: colors.ui.semantic.chrome.border }]} />
      {[false, true].map(isPreview => <IslePressable key={String(isPreview)} haptic accessibilityRole="tab"
        testID={isPreview ? 'document-mode-preview' : 'document-mode-edit'}
        accessibilityLabel={t(isPreview ? 'documents.preview' : 'documents.edit')}
        accessibilityState={{ selected: preview === isPreview }}
        onPress={() => onPreviewChange(isPreview)} style={styles.tab}>
        <Text style={[typography.label, { color: preview === isPreview ? colors.text : colors.textSecondary, textAlign: 'center' }]}>
          {t(isPreview ? 'documents.preview' : 'documents.writeMode')}
        </Text>
      </IslePressable>)}
    </View>
    <IsleButton compact label={t('documents.copyText')} testID="document-copy"
      icon={<AppIcon name="copy" size={16} color={colors.text} />}
      feedbackPhase={copyPhase} feedbackLabel={t('documents.copyNotice')}
      disabled={copyPhase === 'pending'} onPress={onCopy} style={styles.copy} />
  </View>
}

export function DocumentSaveStatus({ status }: { status: 'saving' | 'unsaved' | 'saved' }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const textStyle = { ...colors.design!.semantic.typography.caption, color: status === 'saved' ? colors.ui.tone.success.foreground : colors.textSecondary, paddingLeft: 14 }
  return <View testID="document-save-status-slot" accessibilityState={{ busy: status === 'saving' }} style={styles.saveStatus}>
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, top: 6, width: 5, height: 5, borderRadius: 3, backgroundColor: status === 'saved' ? colors.ui.tone.success.foreground : status === 'saving' ? colors.ui.icon.accentForeground : colors.textTertiary }} />
    {/* The full unsaved notice reserves fluid space, including at large font scale. */}
    <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[textStyle, styles.measurement]}>{t('documents.unsaved')}</Text>
    <Text testID="document-save-status" accessibilityLiveRegion="polite" style={[textStyle, StyleSheet.absoluteFill]}>{t(`documents.${status}`)}</Text>
  </View>
}

export function DocumentContextToggle({ open, label, onPress, testID }: {
  open: boolean
  label: string
  onPress: () => void
  testID: string
}) {
  const { colors } = useAppTheme()
  const motion = useThemeMotion('accent', { readable: true })
  return <IslePressable haptic testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ expanded: open }} onPress={onPress}
    style={[styles.contextToggle, { borderBottomColor: colors.ui.semantic.chrome.border }]}>
    <Text style={[colors.design!.semantic.typography.label, { flex: 1, minWidth: 0, color: colors.textSecondary }]}>{label}</Text>
    <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={motion.intensity === 'full' ? motion.transition : { type: 'timing', duration: 1 }}>
      <AppIcon name="collapse" size={16} color={colors.textTertiary} />
    </MotiView>
  </IslePressable>
}

const styles = StyleSheet.create({
  toolbar: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  stackedToolbar: { flexDirection: 'column', alignItems: 'stretch' },
  tabs: { minWidth: 0, flexGrow: 1, flexBasis: 120, flexDirection: 'row', borderRadius: 8, overflow: 'hidden' },
  stackedTabs: { width: '100%', flexBasis: 'auto', flexGrow: 0 },
  selection: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  copy: { alignSelf: 'flex-end' },
  saveStatus: { minWidth: 0, minHeight: 22 },
  measurement: { opacity: 0 },
  contextToggle: { minWidth: 0, minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
})
