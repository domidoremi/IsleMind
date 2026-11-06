import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { resolveProviderModelAliasAccess, type ProviderModelAccessInput } from '@/bootstrap/providerModelAccess'
import type { AIProvider } from '@/types/providerContracts'
import type { Conversation } from '@/types/chatContracts'
import type { ModelRoutingPlan } from '@/core/modelRoutingPlan'
import { normalizeSearchText } from '@/utils/text'

export function ChatRoutingPlanPicker({ conversation, providers, query, settings, onSelect, onManage }: {
  conversation: Conversation
  providers: readonly AIProvider[]
  query: string
  settings?: ProviderModelAccessInput['settings']
  onSelect: (provider: AIProvider, model: string, plan?: ModelRoutingPlan) => void
  onManage: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const semantic = colors.design!.semantic
  const plans = useSettingsStore(state => state.settings.modelRoutingPlans)
  const current = conversation.routingPlan
  // Keep the selected snapshot visible after the saved template is edited/deleted.
  const choices = current ? [current, ...(plans ?? []).filter(plan => JSON.stringify(plan) !== JSON.stringify(current))] : plans ?? []
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  return <View testID="chat-routing-plans" style={{ gap: 6, marginBottom: 14 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={[semantic.typography.label, { flex: 1, color: colors.text }]}>{t('routing.title')}</Text>
      <IslePressable accessibilityRole="button" onPress={onManage} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
        <Text style={{ color: colors.textSecondary }}>{t('routing.manage')}</Text>
      </IslePressable>
    </View>
    {choices.filter(plan => terms.every(term => normalizeSearchText(`${plan.name} ${plan.primary.model} ${plan.backup?.model ?? ''}`).includes(term))).map((plan, index) => {
      const provider = providers.find(item => item.id === plan.primary.providerId)
      const allowed = !!provider?.enabled && resolveProviderModelAliasAccess({ provider, model: plan.primary.model, settings }).allowed
      const selected = JSON.stringify(current) === JSON.stringify(plan)
      const label = (target: ModelRoutingPlan['primary']) => `${providers.find(item => item.id === target.providerId)?.name ?? target.providerId} · ${target.model}`
      return <IslePressable key={`${plan.id}:${index}`} testID={`routing-plan-choice-${plan.id}-${index}`} accessibilityRole="button"
        accessibilityLabel={`${plan.name} · ${t(plan.mode === 'fixed' ? 'routing.fixed' : 'routing.fallback')}`}
        accessibilityState={{ selected, disabled: !allowed }} disabled={!allowed}
        onPress={() => { if (provider && allowed) onSelect(provider, plan.primary.model, plan) }}
        style={{ minHeight: 54, padding: 12, gap: 6, borderRadius: semantic.radius.medium, borderWidth: 1, borderColor: selected ? semantic.color.primary : 'transparent',
          backgroundColor: selected ? semantic.color.primaryContainer : 'transparent', opacity: allowed ? 1 : 0.6 }}>
        <Text style={[semantic.typography.body, { color: selected ? semantic.color.onPrimaryContainer : colors.text, fontWeight: '600' }]}>{plan.name}{selected ? ` · ${t('routing.selected')}` : ''}</Text>
        <Text style={[semantic.typography.body, { color: colors.textSecondary }]}>{label(plan.primary)}{plan.backup ? ` → ${label(plan.backup)}` : ''}</Text>
        <Text style={[semantic.typography.caption, { color: colors.textSecondary }]}>{t(`routing.${plan.mode}`)}{plan.mode === 'fallback' ? ` · ${t(`routing.${plan.crossProvider}`)}` : ''}</Text>
        {!allowed ? <Text style={[semantic.typography.body, { color: colors.textSecondary }]}>{t('routing.primaryUnavailable')}</Text> : null}
      </IslePressable>
    })}
    {current ? <Text style={[semantic.typography.body, { color: colors.textSecondary }]}>{t('routing.snapshotHint')}</Text> : null}
  </View>
}
