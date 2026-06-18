import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { IsleChip, IsleField, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { formatMemoryMeta, memoryReviewFocusKey } from '@/services/contextAssetFormatters'
import type { MemorySortMode, MemoryStatusFocus } from '@/services/contextAssetFilters'
import type { MemoryItem, MemorySourceKind } from '@/types'
import { filterPendingMemoriesForReview, type MemoryReviewQueueFocus, type MemoryReviewSummary } from '@/utils/memoryReview'

interface MemoryReviewSectionProps {
  memories: MemoryItem[]
  pendingMemories: MemoryItem[]
  filteredMemories: MemoryItem[]
  filteredPendingMemories: MemoryItem[]
  visibleMemories: MemoryItem[]
  memoryStatusCounts: { pending: number; active: number; disabled: number }
  memoryReviewSummary: MemoryReviewSummary
  memoryStatusFocus: MemoryStatusFocus
  memoryReviewFocus: MemoryReviewQueueFocus
  memorySortMode: MemorySortMode
  memoryFilter: string
  hasMemoryFilters: boolean
  canConfirmFilteredMemories: boolean
  canRejectFilteredMemories: boolean
  confirmingMemories: boolean
  memoryPreviewLimit: number
  showAllMemories: boolean
  contextChipPressableStyle: Record<string, unknown>
  itemRowActionStyle: Record<string, unknown>
  fullWidthActionStyle: Record<string, unknown>
  rowActionSurface: () => Record<string, unknown>
  primaryActionSurface: () => Record<string, unknown>
  secondaryActionSurface: () => Record<string, unknown>
  memoryEmptyMessage: string
  onSetMemoryStatusFocus: (value: MemoryStatusFocus) => void
  onSetMemoryReviewFocus: (value: MemoryReviewQueueFocus) => void
  onSetMemorySortMode: (value: MemorySortMode) => void
  onSetMemoryFilter: (value: string) => void
  onResetMemoryFilters: () => void
  onSetShowAllMemories: (value: boolean | ((current: boolean) => boolean)) => void
  onConfirmPendingMemories: (targetMemories?: MemoryItem[], filtered?: boolean) => void
  onRejectPendingMemories: (targetMemories?: MemoryItem[]) => void
  onToggleMemory: (memory: MemoryItem) => Promise<void>
  onDeleteMemory: (memory: MemoryItem) => Promise<void>
  renderDebugStat: (label: string, value: string) => ReactNode
  renderItemRow: (input: {
    key: string
    title: string
    description: string
    meta?: string
    deleteName?: string
    trailing?: string
    onToggle?: () => Promise<void>
    onDelete: () => Promise<void>
  }) => React.ReactNode
}

const memoryReviewSourceFocuses: MemorySourceKind[] = ['imported', 'model', 'deterministic', 'manual', 'legacy']

export function MemoryReviewSection({
  memories,
  pendingMemories,
  filteredMemories,
  filteredPendingMemories,
  visibleMemories,
  memoryStatusCounts,
  memoryReviewSummary,
  memoryStatusFocus,
  memoryReviewFocus,
  memorySortMode,
  memoryFilter,
  hasMemoryFilters,
  canConfirmFilteredMemories,
  canRejectFilteredMemories,
  confirmingMemories,
  memoryPreviewLimit,
  showAllMemories,
  contextChipPressableStyle,
  itemRowActionStyle,
  fullWidthActionStyle,
  rowActionSurface,
  primaryActionSurface,
  secondaryActionSurface,
  memoryEmptyMessage,
  onSetMemoryStatusFocus,
  onSetMemoryReviewFocus,
  onSetMemorySortMode,
  onSetMemoryFilter,
  onResetMemoryFilters,
  onSetShowAllMemories,
  onConfirmPendingMemories,
  onRejectPendingMemories,
  onToggleMemory,
  onDeleteMemory,
  renderDebugStat,
  renderItemRow,
}: MemoryReviewSectionProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()

  return (
    <>
      {memories.length ? (
        <View testID="memory-lifecycle-summary" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {renderDebugStat(t('contextPanel.memoryPendingCount'), String(memoryStatusCounts.pending))}
          {renderDebugStat(t('contextPanel.memoryActiveCount'), String(memoryStatusCounts.active))}
          {renderDebugStat(t('contextPanel.memoryDisabledCount'), String(memoryStatusCounts.disabled))}
        </View>
      ) : null}
      {memoryReviewSummary.pendingCount ? (
        <View testID="memory-review-summary" style={{ marginBottom: 10 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>
            {t('contextPanel.memoryReviewSummary')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {renderDebugStat(t('contextPanel.memoryReviewModel'), String(memoryReviewSummary.modelCount))}
            {renderDebugStat(t('contextPanel.memoryReviewDeterministic'), String(memoryReviewSummary.deterministicCount))}
            {renderDebugStat(t('contextPanel.memoryReviewImported'), String(memoryReviewSummary.importedCount))}
            {renderDebugStat(t('contextPanel.memoryReviewManual'), String(memoryReviewSummary.manualCount))}
            {renderDebugStat(t('contextPanel.memoryReviewLegacy'), String(memoryReviewSummary.legacyCount))}
            {renderDebugStat(t('contextPanel.memoryReviewLowConfidence'), String(memoryReviewSummary.lowConfidenceCount))}
            {renderDebugStat(
              t('contextPanel.memoryReviewAverageConfidence'),
              memoryReviewSummary.averageConfidence === undefined ? '-' : `${Math.round(memoryReviewSummary.averageConfidence * 100)}%`
            )}
          </View>
        </View>
      ) : null}
      {memories.length ? (
        <View testID="memory-status-focus" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {([
            ['all', t('contextPanel.statusFocusAll', { count: memories.length })],
            ['pending', t('contextPanel.statusFocusPending', { count: memoryStatusCounts.pending })],
            ['active', t('contextPanel.statusFocusActive', { count: memoryStatusCounts.active })],
            ['disabled', t('contextPanel.statusFocusDisabled', { count: memoryStatusCounts.disabled })],
          ] satisfies Array<[MemoryStatusFocus, string]>).map(([status, label]) => (
            <IslePressable
              key={status}
              haptic
              onPress={() => {
                onSetMemoryStatusFocus(status)
                onSetMemoryReviewFocus('all')
              }}
              style={contextChipPressableStyle}
            >
              <IsleChip active={memoryStatusFocus === status}>{label}</IsleChip>
            </IslePressable>
          ))}
        </View>
      ) : null}
      {memories.length ? (
        <IsleField
          label={t('contextPanel.memoryFilter')}
          style={{ marginBottom: 10 }}
          inputProps={{
            value: memoryFilter,
            onChangeText: onSetMemoryFilter,
            autoCapitalize: 'none',
            autoCorrect: false,
            placeholder: t('contextPanel.memoryFilterPlaceholder'),
          }}
        />
      ) : null}
      {memories.length ? (
        <View testID="memory-sort-mode" style={{ marginBottom: 10 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>{t('contextPanel.memorySort')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {([
              ['updated', t('contextPanel.memorySortUpdated')],
              ['created', t('contextPanel.memorySortCreated')],
              ['lastUsed', t('contextPanel.memorySortLastUsed')],
            ] satisfies Array<[MemorySortMode, string]>).map(([mode, label]) => (
              <IslePressable key={mode} haptic onPress={() => onSetMemorySortMode(mode)} style={contextChipPressableStyle}>
                <IsleChip active={memorySortMode === mode}>{label}</IsleChip>
              </IslePressable>
            ))}
          </View>
        </View>
      ) : null}
      {hasMemoryFilters ? (
        <View testID="memory-filter-summary" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, flex: 1, minWidth: 0 }}>
            {t('contextPanel.memoryFilterSummary', { count: filteredMemories.length, total: memories.length })}
          </Text>
          <IslePressable
            haptic
            onPress={onResetMemoryFilters}
            accessibilityLabel={t('contextPanel.clearMemoryFilters')}
            style={{ ...itemRowActionStyle, ...rowActionSurface() }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.clearMemoryFilters')}</Text>
          </IslePressable>
        </View>
      ) : null}
      {memoryReviewSummary.pendingCount ? (
        <View testID="memory-review-focus" style={{ marginBottom: 10 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>{t('contextPanel.memoryReviewQueue')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {([
              ['all', t('contextPanel.memoryReviewAll', { count: pendingMemories.length })],
              ...memoryReviewSourceFocuses.map((sourceKind) => [
                sourceKind,
                t(memoryReviewFocusKey(sourceKind), { count: filterPendingMemoriesForReview(pendingMemories, sourceKind).length }),
              ] satisfies [MemoryReviewQueueFocus, string]),
              ['lowConfidence', t('contextPanel.memoryReviewLowConfidenceFilter', { count: filterPendingMemoriesForReview(pendingMemories, 'lowConfidence').length })],
            ] satisfies Array<[MemoryReviewQueueFocus, string]>).map(([reviewFocus, label]) => (
              <IslePressable
                key={reviewFocus}
                haptic
                onPress={() => {
                  onSetMemoryStatusFocus('pending')
                  onSetMemoryReviewFocus(reviewFocus)
                  onSetShowAllMemories(true)
                }}
                style={contextChipPressableStyle}
              >
                <IsleChip active={memoryStatusFocus === 'pending' && memoryReviewFocus === reviewFocus}>{label}</IsleChip>
              </IslePressable>
            ))}
          </View>
        </View>
      ) : null}
      {canConfirmFilteredMemories ? (
        <IslePressable
          haptic
          onPress={() => onConfirmPendingMemories(filteredPendingMemories, true)}
          disabled={confirmingMemories}
          accessibilityLabel={t('contextPanel.confirmFilteredPendingMemoriesTitle', { count: filteredPendingMemories.length })}
          style={{ ...fullWidthActionStyle, ...secondaryActionSurface(), marginBottom: 10, opacity: confirmingMemories ? 0.65 : 1 }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '900' }}>
            {confirmingMemories ? t('contextPanel.confirmingPendingMemories') : t('contextPanel.confirmFilteredPendingMemories', { count: filteredPendingMemories.length })}
          </Text>
        </IslePressable>
      ) : null}
      {canRejectFilteredMemories ? (
        <IslePressable
          haptic
          onPress={() => onRejectPendingMemories(filteredPendingMemories)}
          disabled={confirmingMemories}
          accessibilityLabel={t('contextPanel.rejectFilteredPendingMemoriesTitle', { count: filteredPendingMemories.length })}
          style={{ ...fullWidthActionStyle, ...secondaryActionSurface(), marginBottom: 10, borderColor: colors.ui.tone.danger.border, opacity: confirmingMemories ? 0.65 : 1 }}
        >
          <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 13, fontWeight: '900' }}>
            {confirmingMemories ? t('contextPanel.confirmingPendingMemories') : t('contextPanel.rejectFilteredPendingMemories', { count: filteredPendingMemories.length })}
          </Text>
        </IslePressable>
      ) : null}
      {pendingMemories.length ? (
        <IslePressable
          haptic
          onPress={() => onConfirmPendingMemories()}
          disabled={confirmingMemories}
          accessibilityLabel={t('contextPanel.confirmPendingMemoriesTitle', { count: pendingMemories.length })}
          style={{ ...fullWidthActionStyle, ...primaryActionSurface(), marginBottom: 10, opacity: confirmingMemories ? 0.65 : 1 }}
        >
          <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 13, fontWeight: '900' }}>
            {confirmingMemories ? t('contextPanel.confirmingPendingMemories') : t('contextPanel.confirmPendingMemories', { count: pendingMemories.length })}
          </Text>
        </IslePressable>
      ) : null}
      {filteredMemories.length > memoryPreviewLimit ? (
        <Text testID="memory-list-showing-count" style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginBottom: 8 }}>
          {t('contextPanel.memoryListShowing', { shown: visibleMemories.length, total: filteredMemories.length })}
        </Text>
      ) : null}
      {hasMemoryFilters && !filteredMemories.length ? (
        <Text testID="memory-filter-empty" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 }}>
          {memoryEmptyMessage}
        </Text>
      ) : null}
      {visibleMemories.map((memory) => renderItemRow({
        key: memory.id,
        title: memory.status === 'pending' ? t('contextPanel.pendingMemory') : memory.status === 'active' ? t('settings.longMemory') : t('contextPanel.disabledMemory'),
        description: memory.content,
        meta: formatMemoryMeta(memory, t),
        deleteName: memory.content,
        trailing: memory.status === 'pending' ? t('contextPanel.confirmMemory') : memory.status === 'disabled' ? t('contextPanel.restoreMemory') : t('contextPanel.disableMemory'),
        onToggle: async () => onToggleMemory(memory),
        onDelete: async () => onDeleteMemory(memory),
      }))}
      {filteredMemories.length > memoryPreviewLimit ? (
        <IslePressable
          haptic
          onPress={() => onSetShowAllMemories((current) => !current)}
          accessibilityLabel={showAllMemories ? t('contextPanel.showFewerMemories') : t('contextPanel.showAllMemories', { count: filteredMemories.length })}
          testID="memory-list-toggle"
          style={{ ...fullWidthActionStyle, ...secondaryActionSurface(), marginTop: 10 }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '800' }}>
            {showAllMemories
              ? t('contextPanel.showFewerMemories')
              : t('contextPanel.showMoreMemories', { count: filteredMemories.length - visibleMemories.length })}
          </Text>
        </IslePressable>
      ) : null}
    </>
  )
}
