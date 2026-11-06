import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { ContextCapacityView } from '@/modules/assistant-runtime'

const PAGE_SIZE = 8
const AUTHORITIES = new Set(['system', 'user-private', 'external-public', 'permissioned-tool', 'conversation', 'local-state'])
const REASONS = new Set(['included', 'capped', 'empty', 'token_cap_exceeded', 'unbounded_fragment_blocked'])

/** Reads only metadata already present in this exact plan projection. */
export function ContextCapacitySources({ view, type }: { view: ContextCapacityView; type: string }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sources = (view.sources ?? []).filter(source => (source.type.trim() || 'unknown') === type)
  return <View testID="chat-context-source-detail" style={styles.detail}>
    <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('chat.contextCapacity.sourceMetadataHint')}</Text>
    {!sources.length ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('chat.contextCapacity.sourceMetadataMissing')}</Text> : null}
    {sources.slice(0, visibleCount).map((source, index) => <View key={`${index}:${source.fragmentId}`} testID={`chat-context-source-${index}`}
      style={[styles.source, { borderColor: colors.ui.section.divider }]}>
      <Text style={[styles.identity, { color: colors.text }]} selectable>{source.sourceId}</Text>
      <Text style={[styles.hint, { color: colors.textTertiary }]} selectable>{t('chat.contextCapacity.sourceFragment', { id: source.fragmentId })}</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{t(`chat.contextCapacity.decision.${source.decision}`)}</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('chat.contextCapacity.sourceBudget', {
        used: source.decision === 'excluded' ? 0 : source.estimatedTokens, original: source.originalEstimatedTokens, cap: source.tokenCap,
      })}</Text>
      {source.sourceCount !== undefined ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('chat.contextCapacity.sourceCount', { count: source.sourceCount })}</Text> : null}
      {source.authority ? <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('chat.contextCapacity.sourceAuthority', {
        authority: t(`chat.contextCapacity.authority.${AUTHORITIES.has(source.authority) ? source.authority : 'unknown'}`),
      })}</Text> : null}
      {source.reason ? <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('chat.contextCapacity.sourceReason', {
        reason: t(`chat.contextCapacity.reason.${REASONS.has(source.reason) ? source.reason : 'unknown'}`),
      })}</Text> : null}
      <SourceIdentities label={t('chat.contextCapacity.includedIdentities')} ids={source.includedSourceIds} />
      <SourceIdentities label={t('chat.contextCapacity.excludedIdentities')} ids={source.excludedSourceIds} />
    </View>)}
    {sources.length > visibleCount ? <IslePressable accessibilityRole="button"
      accessibilityLabel={t('chat.contextCapacity.moreSources', { count: sources.length - visibleCount })}
      onPress={() => setVisibleCount(count => count + PAGE_SIZE)} style={styles.action}>
      <Text style={[styles.hint, { color: colors.ui.icon.accentForeground }]}>{t('chat.contextCapacity.moreSources', { count: sources.length - visibleCount })}</Text>
    </IslePressable> : null}
    {type === 'recent_messages' || type === 'history_summary' ? <>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('chat.contextCapacity.plannedMessagesHint')}</Text>
      <SourceIdentities label={t('chat.contextCapacity.plannedMessages')} ids={view.sourceMessageIds} />
    </> : null}
  </View>
}

function SourceIdentities({ label, ids }: { label: string; ids?: readonly string[] }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  if (!ids?.length) return null
  return <View style={styles.identities}>
    <Text style={[styles.hint, { color: colors.textSecondary }]}>{label} · {ids.length}</Text>
    {ids.slice(0, visibleCount).map((id, index) => <Text key={`${index}:${id}`} selectable
      style={[styles.identity, { color: colors.textTertiary }]}>{id}</Text>)}
    {ids.length > visibleCount ? <IslePressable accessibilityRole="button"
      accessibilityLabel={t('chat.contextCapacity.moreIdentities', { count: ids.length - visibleCount })}
      onPress={() => setVisibleCount(count => count + PAGE_SIZE)} style={styles.action}>
      <Text style={[styles.hint, { color: colors.ui.icon.accentForeground }]}>{t('chat.contextCapacity.moreIdentities', { count: ids.length - visibleCount })}</Text>
    </IslePressable> : null}
  </View>
}

const styles = StyleSheet.create({
  detail: { gap: 10, minWidth: 0 },
  source: { gap: 5, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, minWidth: 0 },
  hint: { fontSize: 12, lineHeight: 18 },
  identity: { fontSize: 12, lineHeight: 18, flexShrink: 1 },
  identities: { gap: 4, minWidth: 0 },
  action: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 },
})
