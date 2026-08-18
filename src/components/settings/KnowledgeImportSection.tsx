import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IsleField, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

interface KnowledgeImportSectionProps {
  importing: boolean
  plainTitle: string
  plainText: string
  onPlainTitleChange: (value: string) => void
  onPlainTextChange: (value: string) => void
  onImportFile: () => void
  onImportPlainText: () => void
}

export function KnowledgeImportSection({
  importing,
  plainTitle,
  plainText,
  onPlainTitleChange,
  onPlainTextChange,
  onImportFile,
  onImportPlainText,
}: KnowledgeImportSectionProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [pasteOpen, setPasteOpen] = useState(false)
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const foldoutPanelStyle = {
    borderRadius: Math.min(colors.ui.radius.card, 8),
    padding: 10,
    backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    borderWidth: subtleBorderWidth,
    borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
  } as const

  return (
    <>
      <IslePressable
        haptic
        accessibilityRole="button"
        accessibilityLabel={t('contextPanel.importKnowledgeFile')}
        accessibilityState={{ disabled: importing }}
        onPress={onImportFile}
        disabled={importing}
        style={{
          marginTop: 10,
          minHeight: 48,
          backgroundColor: colors.ui.control.primaryBackground,
          borderWidth: subtleBorderWidth,
          borderColor: colors.ui.control.primaryBorder,
          borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: importing ? 0.65 : 1,
        }}
      >
        <AppIcon name="upload" color={colors.ui.control.primaryForeground} size={18} />
        <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>
          {importing ? t('contextPanel.importing') : t('contextPanel.importKnowledgeFile')}
        </Text>
      </IslePressable>

      <IslePressable
        haptic
        accessibilityRole="button"
        accessibilityLabel={`${t('contextPanel.pasteTextKnowledge')}. ${plainText.trim() ? t('contextPanel.pasteTextDraftReady', { count: plainText.trim().length }) : t('contextPanel.pasteTextCollapsedHint')}`}
        accessibilityState={{ expanded: pasteOpen }}
        onPress={() => setPasteOpen((value) => !value)}
        style={{
          marginTop: 10,
          minHeight: ISLE_MIN_TOUCH_TARGET,
          borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
          borderWidth: subtleBorderWidth,
          borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
        }}
      >
        <AppIcon name="edit" color={colors.textTertiary} size={16} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>
            {t('contextPanel.pasteTextKnowledge')}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>
            {plainText.trim() ? t('contextPanel.pasteTextDraftReady', { count: plainText.trim().length }) : t('contextPanel.pasteTextCollapsedHint')}
          </Text>
        </View>
        <MotiView animate={{ rotate: pasteOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
          <AppIcon name="collapse" color={colors.textTertiary} size={16} />
        </MotiView>
      </IslePressable>

      {pasteOpen ? (
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ marginTop: 10, ...foldoutPanelStyle }}>
          <KnowledgeImportFoldoutHeader title={t('contextPanel.pasteTextKnowledge')} detail={plainText.trim() ? t('contextPanel.pasteTextDraftReady', { count: plainText.trim().length }) : t('contextPanel.pasteTextCollapsedHint')} />
          <IsleField
            label={t('contextPanel.knowledgeTitle')}
            inputProps={{ value: plainTitle, onChangeText: onPlainTitleChange, placeholder: t('contextPanel.knowledgeTitle') }}
          />
          <IsleField
            label={t('contextPanel.body')}
            style={{ marginTop: 10 }}
            inputProps={{
              value: plainText,
              onChangeText: onPlainTextChange,
              multiline: true,
              placeholder: t('contextPanel.body'),
              style: { minHeight: 60, maxHeight: 116 },
            }}
          />
          <IslePressable
            haptic
            accessibilityRole="button"
            accessibilityLabel={t('contextPanel.importPastedText')}
            accessibilityState={{ disabled: importing || !plainText.trim() }}
            onPress={onImportPlainText}
            disabled={importing || !plainText.trim()}
            style={{
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              backgroundColor: colors.ui.control.primaryBackground,
              borderWidth: subtleBorderWidth,
              borderColor: colors.ui.control.primaryBorder,
              borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
              marginTop: 10,
              opacity: importing || !plainText.trim() ? 0.45 : 1,
            }}
          >
            <AppIcon name="add" color={colors.ui.control.primaryForeground} size={16} />
            <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>
              {t('contextPanel.importPastedText')}
            </Text>
          </IslePressable>
        </MotiView>
      ) : null}
    </>
  )
}

function KnowledgeImportFoldoutHeader({ title, detail }: { title: string; detail: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ marginBottom: 10 }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>
        {title}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
        {detail}
      </Text>
    </View>
  )
}
