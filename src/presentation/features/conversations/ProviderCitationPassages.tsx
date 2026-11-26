import { useContext, useMemo, useState } from 'react'
import { View } from 'react-native'
import { ScrollView } from '@/components/ui/AppScrollView'
import { AppFontContext, Text } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import { isProviderCitationSupportCurrent, parseProviderCitationSupport } from '@/core'
import { IsleButton, IslePanel } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export function ProviderCitationPassages({ value, answerText }: { value: unknown; answerText: string }) {
  const { t } = useTranslation()
  const { colors, design } = useAppTheme()
  const fontFamily = useContext(AppFontContext)
  const [expanded, setExpanded] = useState(false)
  const support = useMemo(() => parseProviderCitationSupport(value), [value])
  const current = useMemo(() => Boolean(support && isProviderCitationSupportCurrent(support, answerText)), [support, answerText])
  if (!support) {
    return <Text style={[design.semantic.typography.caption, { fontFamily, color: colors.textSecondary, marginHorizontal: 18, marginVertical: 8 }]}>
      {t('source.providerPassagesUnknown')}
    </Text>
  }
  return (
    <IslePanel material="raised" elevated={false} style={{ marginHorizontal: 12, marginTop: 8, padding: 12 }}>
      <IsleButton
        label={t(expanded ? 'source.hideProviderPassages' : 'source.showProviderPassages', { count: support.passages.length })}
        onPress={() => setExpanded((value) => !value)}
      />
      <Text style={[design.semantic.typography.caption, { fontFamily, color: colors.textSecondary, marginTop: 6 }]}>{t('source.providerPassagesNotice')}</Text>
      {!current ? <Text accessibilityRole="alert" style={[design.semantic.typography.caption, { fontFamily, color: colors.ui.tone.warning.foreground, marginTop: 6 }]}>
        {t('source.providerPassagesHistorical')}
      </Text> : null}
      {expanded ? <ScrollView style={{ maxHeight: 240, marginTop: 8 }} nestedScrollEnabled>
        <Text style={[design.semantic.typography.caption, { fontFamily, color: colors.textSecondary }]}>{t('source.providerPassagesRangeNotice')}</Text>
        {support.passages.map((passage, index) => <View key={index} style={{ marginTop: 12 }}>
          <Text selectable style={[design.semantic.typography.body, { fontFamily, color: colors.text }]}>{passage.text}</Text>
          <Text style={[design.semantic.typography.caption, { fontFamily, color: colors.textTertiary, marginTop: 4 }]}>
            {t('source.providerPassageRange', { part: passage.partIndex, start: passage.startByte, end: passage.endByte })}
          </Text>
        </View>)}
      </ScrollView> : null}
    </IslePanel>
  )
}
