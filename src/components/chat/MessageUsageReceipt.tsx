import { useCallback, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { Message } from '@/types/chatContracts'
import { normalizeMessageUsageExecution } from '@/modules/conversations'
import { knownUsageTotal } from '@/modules/diagnostics'
import { responseUsageReceipts } from '@/bootstrap/responseUsageReceipts'
import { usageDuration, usageKnownCost } from '@/presentation/features/settings/usageExecutionPresentation'
import { Text } from '@/components/ui/AppText'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export function MessageUsageReceipt({ conversationId, message }: { conversationId: string; message: Message }) {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const reference = normalizeMessageUsageExecution(message.usageExecution)
  const id = reference?.responseExecutionId ?? ''
  const subscribe = useCallback((listener: () => void) => responseUsageReceipts.subscribe(id, listener), [id])
  const get = useCallback(() => responseUsageReceipts.get(id), [id])
  const summary = useSyncExternalStore(subscribe, get, get)
  if (!reference || !reference.requestIds.length) return null
  const hasAllCalls = summary && summary.logicalRequestCount === reference.requestIds.length
    && reference.requestIds.every(requestId => summary.logicalRequestIds.includes(requestId))
  const tokens = hasAllCalls ? summary.totalTokens : message.usage ? knownUsageTotal(message.usage) : undefined
  const readings = [
    message.durationMs === undefined ? undefined : usageDuration(message.durationMs),
    tokens === undefined ? undefined : t('usage.receiptTokens', { count: tokens.toLocaleString(i18n.language) }),
    hasAllCalls ? usageKnownCost(summary, t) : t('usage.costInDetails'),
    message.usage?.source === 'estimated' ? t('usage.localEstimate') : undefined,
  ].filter(Boolean).join(' · ')
  return <View testID={`message-usage-${message.id}`} style={{ gap: 4, marginTop: 8, minWidth: 0 }}>
    <Text style={[colors.design!.semantic.typography.caption, { color: colors.textSecondary }]}>{readings}</Text>
    <IslePressable testID={`message-usage-detail-${message.id}`} accessibilityRole="button" accessibilityLabel={t('usage.receiptDetails')}
      onPress={() => router.push({ pathname: '/request/[id]', params: { id, kind: 'response', conversationId, returnTo: 'chat' } })}
      style={{ minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingVertical: 8 }}>
      <Text style={[colors.design!.semantic.typography.label, { color: colors.ui.icon.accentForeground }]}>{t('usage.receiptDetails')}</Text>
    </IslePressable>
  </View>
}
