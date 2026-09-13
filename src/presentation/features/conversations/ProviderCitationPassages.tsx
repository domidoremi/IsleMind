import { useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { isProviderCitationSupportCurrent, parseProviderCitationSupport } from '@/core'
import { IsleButton, IslePanel } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export function ProviderCitationPassages({ value, answerText }: { value: unknown; answerText: string }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  const support = useMemo(() => parseProviderCitationSupport(value), [value])
  const current = useMemo(() => Boolean(support && isProviderCitationSupportCurrent(support, answerText)), [support, answerText])
  if (!support) {
    return <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginHorizontal: 18, marginVertical: 8 }}>
      {t('source.providerPassagesUnknown')}
    </Text>
  }
  return (
    <IslePanel material="raised" elevated={false} style={{ marginHorizontal: 12, marginTop: 8, padding: 12 }}>
      <IsleButton
        label={t(expanded ? 'source.hideProviderPassages' : 'source.showProviderPassages', { count: support.passages.length })}
        onPress={() => setExpanded((value) => !value)}
      />
      <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 6 }}>{t('source.providerPassagesNotice')}</Text>
      {!current ? <Text accessibilityRole="alert" style={{ color: colors.ui.tone.warning.foreground, fontSize: 12, lineHeight: 18, marginTop: 6 }}>
        {t('source.providerPassagesHistorical')}
      </Text> : null}
      {expanded ? <ScrollView style={{ maxHeight: 240, marginTop: 8 }} nestedScrollEnabled>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{t('source.providerPassagesRangeNotice')}</Text>
        {support.passages.map((passage, index) => <View key={index} style={{ marginTop: 12 }}>
          <Text selectable style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>{passage.text}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
            {t('source.providerPassageRange', { part: passage.partIndex, start: passage.startByte, end: passage.endByte })}
          </Text>
        </View>)}
      </ScrollView> : null}
    </IslePanel>
  )
}
