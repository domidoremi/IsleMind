import { StyleSheet, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { IsleField, IslePressable, IsleSection } from '@/components/ui/isle'
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
  const subtleBorderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth

  return (
    <>
      <IslePressable
        haptic
        onPress={onImportFile}
        disabled={importing}
        style={{
          marginTop: 12,
          minHeight: 54,
          backgroundColor: colors.ui.control.primaryBackground,
          borderWidth: subtleBorderWidth,
          borderColor: colors.ui.control.primaryBorder,
          borderRadius: colors.ui.radius.controlLarge,
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

      <IsleSection title={t('contextPanel.pasteTextKnowledge')} material="raised" style={{ marginTop: 12 }}>
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
            style: { minHeight: 96, maxHeight: 180 },
          }}
        />
        <IslePressable
          haptic
          onPress={onImportPlainText}
          disabled={importing || !plainText.trim()}
          style={{
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.ui.control.primaryBackground,
            borderWidth: subtleBorderWidth,
            borderColor: colors.ui.control.primaryBorder,
            borderRadius: colors.ui.radius.controlLarge,
            marginTop: 10,
            opacity: importing || !plainText.trim() ? 0.45 : 1,
          }}
        >
          <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>
            {t('contextPanel.importPastedText')}
          </Text>
        </IslePressable>
      </IsleSection>
    </>
  )
}
