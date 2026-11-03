import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { IsleButton, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import { WorkspaceChoice } from '@/presentation/layout/WorkspaceChoice'
import type { ActionFeedbackPhase } from '@/hooks/useActionFeedback'

export function DocumentEditorToolbar({ preview, onPreviewChange, copyPhase, onCopy, copyDisabled = false }: {
  preview: boolean
  onPreviewChange: (preview: boolean) => void
  copyPhase: ActionFeedbackPhase
  onCopy: () => void
  copyDisabled?: boolean
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width, fontScale } = useWindowDimensions()
  const stacked = width / fontScale < 300
  return <View testID="document-editor-toolbar" style={[styles.toolbar, stacked && styles.stackedToolbar]}>
    <View accessibilityRole="tablist" style={[styles.tabs, stacked && styles.stackedTabs]}>
      {[false, true].map(isPreview => <WorkspaceChoice key={String(isPreview)}
        testID={isPreview ? 'document-mode-preview' : 'document-mode-edit'}
        accessibilityLabel={t(isPreview ? 'documents.preview' : 'documents.edit')}
        label={t(isPreview ? 'documents.preview' : 'documents.writeMode')} selected={preview === isPreview}
        onPress={() => onPreviewChange(isPreview)} style={styles.tab} />)}
    </View>
    <IsleButton compact label={t('documents.copyText')} testID="document-copy"
      icon={<AppIcon name="copy" size={16} color={colors.text} />}
      feedbackPhase={copyPhase} feedbackLabel={t('common.copied')}
      disabled={copyDisabled || copyPhase === 'pending'} onPress={onCopy} style={styles.copy} />
  </View>
}

export function DocumentSaveStatus({ status }: { status: 'new' | 'saving' | 'unsaved' | 'saved' }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const textStyle = { ...colors.design!.semantic.typography.caption, color: status === 'saved' ? colors.ui.tone.success.foreground : colors.textSecondary, paddingLeft: 14 }
  return <View testID="document-save-status-slot" accessibilityState={{ busy: status === 'saving' }} style={styles.saveStatus}>
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, top: 6, width: 5, height: 5, borderRadius: 3, backgroundColor: status === 'saved' ? colors.ui.tone.success.foreground : status === 'saving' ? colors.ui.icon.accentForeground : colors.textTertiary }} />
    {/* Reserve the longest status so saving does not shift the title. */}
    <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[textStyle, styles.measurement]}>{t('documents.saved')}</Text>
    <Text testID="document-save-status" accessibilityLiveRegion="polite" style={[textStyle, StyleSheet.absoluteFill]}>{t(status === 'new' ? 'documents.newDraft' : `documents.${status}`)}</Text>
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
  tabs: { minWidth: 0, flexGrow: 1, flexBasis: 120, flexDirection: 'row', gap: 4 },
  stackedTabs: { width: '100%', flexBasis: 'auto', flexGrow: 0 },
  tab: { flex: 1, minWidth: 0 },
  copy: { alignSelf: 'flex-end' },
  saveStatus: { minWidth: 0, minHeight: 22 },
  measurement: { opacity: 0 },
  contextToggle: { minWidth: 0, minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
})
