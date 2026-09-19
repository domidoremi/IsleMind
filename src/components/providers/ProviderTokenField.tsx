import { useState } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { IsleField, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export function ProviderTokenField({ value, onChangeText, onFocus }: {
  value: string
  onChangeText(value: string): void
  onFocus(): void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const [batch, setBatch] = useState(false)
  const [revealed, setRevealed] = useState(false)
  // Existing explicit clipboard import may supply several credentials. Never
  // silently flatten or discard them when switching the editing presentation.
  const multipleValues = /[\r\n]/.test(value.trim())
  const multiline = batch || multipleValues
  return (
    <View>
      <IsleField label={t('providerSettings.tokens')}
        note={t(multiline ? 'providerSettings.batchTokensVisible' : 'providerSettings.singleTokenHint')}
        inputProps={{ value, onChangeText, onFocus, placeholder: multiline ? 'sk-...\nsk-...' : 'sk-...',
          autoCapitalize: 'none', autoCorrect: false, autoComplete: 'off',
          multiline, secureTextEntry: !multiline && !revealed }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {!multiline ? (
          <IslePressable accessibilityRole="button" accessibilityLabel={t(revealed ? 'providerSettings.hideToken' : 'providerSettings.showToken')}
            onPress={() => setRevealed(!revealed)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: colors.textSecondary }}>{t(revealed ? 'providerSettings.hideToken' : 'providerSettings.showToken')}</Text>
          </IslePressable>
        ) : null}
        {!multipleValues ? (
          <IslePressable accessibilityRole="button" accessibilityState={{ expanded: multiline }}
            onPress={() => { setBatch(!batch); setRevealed(false) }} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: colors.textSecondary }}>{t(multiline ? 'providerSettings.singleToken' : 'providerSettings.multipleTokens')}</Text>
          </IslePressable>
        ) : null}
      </View>
    </View>
  )
}
