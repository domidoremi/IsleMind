import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { AssistantToolDeclarationReceipt } from '@/modules/assistant-runtime'

/** Captured first-request diagnostics; characters remain separate from token estimates. */
export function ToolDeclarationReport({ receipt }: { receipt: AssistantToolDeclarationReceipt }) {
  const { colors } = useAppTheme()
  const { t, i18n } = useTranslation()
  const format = (value: number) => value.toLocaleString(i18n.language)
  return <View testID="chat-context-tool-declarations" style={{ gap: 6, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.section.divider }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 14, lineHeight: 21, fontWeight: '700' }}>{t('toolDeclarations.title')}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
        {t(receipt.mode === 'full' ? 'toolDeclarations.full' : 'toolDeclarations.discovery')}
      </Text>
    </View>
    <Text testID="chat-context-tool-declaration-counts" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
      {t('toolDeclarations.declared', { declared: format(receipt.declaredCount), total: format(receipt.totalCount), deferred: format(receipt.deferredCount) })}
    </Text>
    <Text testID="chat-context-tool-declaration-chars" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
      {t('toolDeclarations.characters', { chars: format(receipt.declarationChars) })}
      {receipt.mode === 'discovery' ? ` · ${t('toolDeclarations.fullCharacters', { chars: format(receipt.fullDeclarationChars) })}` : ''}
    </Text>
    {receipt.mode === 'discovery' && receipt.declarationChars > receipt.budgetChars ? <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: 13, lineHeight: 20 }}>
      {t('toolDeclarations.overBudget', { chars: format(receipt.budgetChars) })}
    </Text> : null}
    <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 18 }}>{t('toolDeclarations.recordedHint')}</Text>
  </View>
}
