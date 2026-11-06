import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import type { useAppTheme } from '@/hooks/useAppTheme'
import type { ProviderModelSource } from '@/utils/providerModelSources'

export function ProviderModelSourceFilter({
  sources, selectedSourceId, onSelect, colors,
}: {
  sources: readonly ProviderModelSource[]
  selectedSourceId: string | null
  onSelect: (sourceId: string | null) => void
  colors: ReturnType<typeof useAppTheme>['colors']
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  if (sources.length < 2) return null
  const sourceName = (source: ProviderModelSource) => source.automatic ? t('providerSettings.automaticRouting') : source.name
  const selected = sources.find(source => source.id === selectedSourceId)
  const label = selected ? sourceName(selected) : t('providerSettings.allModelSources')
  const choose = (sourceId: string | null) => { onSelect(sourceId); setExpanded(false) }
  return (
    <View style={{ gap: 4 }}>
      <IslePressable
        testID="provider-model-source-filter"
        accessibilityRole="button"
        accessibilityLabel={`${t('providerSettings.modelSource')}: ${label}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)}
        style={{ minHeight: ISLE_MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 8,
          borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}
      >
        <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 13, fontWeight: '700' }}>
          {t('providerSettings.modelSource')}: {label}
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
          {t('providerSettings.modelSourceCount', { count: sources.length })}
        </Text>
        <AppIcon name={expanded ? 'collapse' : 'back-next'} color={colors.textSecondary} size={16} />
      </IslePressable>
      {expanded ? (
        <View testID="provider-model-source-options" style={{ gap: 2 }}>
          {[{ id: null, name: t('providerSettings.allModelSources'), models: sources.flatMap(source => source.models) },
            ...sources.map(source => ({ ...source, name: sourceName(source) }))].map(source => (
            <IslePressable
              key={source.id ?? 'all'}
              accessibilityRole="button"
              accessibilityLabel={source.name}
              accessibilityState={{ selected: selectedSourceId === source.id }}
              onPress={() => choose(source.id)}
              style={{ minHeight: ISLE_MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
                backgroundColor: selectedSourceId === source.id ? colors.ui.actionBar.itemActiveBackground : 'transparent' }}
            >
              <Text style={{ flex: 1, color: colors.text, fontSize: 13 }}>{source.name}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{source.models.length}</Text>
            </IslePressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

export const PROVIDER_MODEL_PAGE_SIZE = 24

export function ProviderModelPagination({
  total, page, onChange, colors,
}: {
  total: number
  page: number
  onChange: (page: number) => void
  colors: ReturnType<typeof useAppTheme>['colors']
}) {
  const { t } = useTranslation()
  if (total <= PROVIDER_MODEL_PAGE_SIZE) return null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ flex: 1, color: colors.textTertiary, fontSize: 12 }}>
        {t('providerSettings.modelPageRange', {
          start: page * PROVIDER_MODEL_PAGE_SIZE + 1,
          end: Math.min(total, (page + 1) * PROVIDER_MODEL_PAGE_SIZE), total,
        })}
      </Text>
      {[
        { label: t('providerSettings.previousModelPage'), next: page - 1, disabled: page === 0 },
        { label: t('providerSettings.nextModelPage'), next: page + 1, disabled: (page + 1) * PROVIDER_MODEL_PAGE_SIZE >= total },
      ].map(action => (
        <IslePressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label}
          disabled={action.disabled} accessibilityState={{ disabled: action.disabled }}
          onPress={() => onChange(action.next)}
          style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 8 }}>
          <Text style={{ color: action.disabled ? colors.textTertiary : colors.primary, fontSize: 13 }}>{action.label}</Text>
        </IslePressable>
      ))}
    </View>
  )
}
