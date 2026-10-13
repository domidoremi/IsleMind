import { fireEvent, render } from '@testing-library/react-native'
import type { ComponentProps } from 'react'
import { MemoryReviewSection } from './MemoryReviewSection'
import { KnowledgeImportSection } from './KnowledgeImportSection'
import { ContextDiagnosticsSection } from './ContextDiagnosticsSection'
import { buildMemoryReviewSummary } from '@/utils/memoryReview'
import type { MemoryItem } from '@/types/contextContracts'
let mockMotion = 'full'
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => {
  const { View } = require('react-native')
  return { MotiView: (props: any) => <View testID="context-motion" {...props} /> }
})
jest.mock('@/components/ui/isle', () => {
  const { View, Text, TextInput, Pressable } = require('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, ThemeExpressionRegion: View, IsleChip: Text, IslePressable: Pressable,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} /> }
})

it.each(['reduced', 'none'])('respects %s motion in memory, knowledge and diagnostics disclosures', async motion => {
  mockMotion = motion
  const screen = await render(<>
    <MemoryReviewSection {...props} />
    <KnowledgeImportSection importing={false} plainTitle="" plainText="" onPlainTitleChange={jest.fn()} onPlainTextChange={jest.fn()} onImportFile={jest.fn()} onImportPlainText={jest.fn()} />
    <ContextDiagnosticsSection selfTesting={false} selfTestResult={{ ranAt: 1, steps: [] }} ragEvaluating={false} ragEvaluation={null} ragLogs={[]} indexingJobs={[]} onRunSelfTest={jest.fn()} onRunRagEvaluation={jest.fn()} primaryActionStyle={{}} assetCardSurface={() => ({})} />
  </>)
  await fireEvent.press(screen.getByLabelText(/contextPanel.pasteTextKnowledge/))
  await fireEvent.press(screen.getByLabelText(/contextPanel.lastSelfTest/))
  const animations = screen.getAllByTestId('context-motion')
  expect(animations.length).toBeGreaterThan(4)
  for (const animation of animations) {
    expect(animation.props.transition.duration).toBe(0)
    expect(animation.props.from).toBeUndefined()
  }
  expect(screen.getByLabelText('contextPanel.body')).toBeTruthy()
  expect(screen.getByTestId('memory-review-summary')).toBeTruthy()
  mockMotion = 'full'
})

const memory = { id: 'qa', content: 'Local test memory', status: 'pending', sourceKind: 'imported' } as MemoryItem
const props: ComponentProps<typeof MemoryReviewSection> = {
  memories: [memory], pendingMemories: [memory], filteredMemories: [memory], filteredPendingMemories: [memory], visibleMemories: [memory],
  memoryStatusCounts: { pending: 1, active: 0, disabled: 0 }, memoryReviewSummary: buildMemoryReviewSummary([memory]),
  memoryStatusFocus: 'pending', memoryReviewFocus: 'imported', memorySortMode: 'updated', memoryFilter: 'Local',
  hasMemoryFilters: true, canConfirmFilteredMemories: true, canRejectFilteredMemories: true, confirmingMemories: false,
  memoryPreviewLimit: 6, showAllMemories: false, contextChipPressableStyle: {}, itemRowActionStyle: {}, fullWidthActionStyle: {},
  rowActionSurface: () => ({}), primaryActionSurface: () => ({}), secondaryActionSurface: () => ({}), memoryEmptyMessage: '',
  onSetMemoryStatusFocus: jest.fn(), onSetMemoryReviewFocus: jest.fn(), onSetMemorySortMode: jest.fn(), onSetMemoryFilter: jest.fn(),
  onResetMemoryFilters: jest.fn(), onSetShowAllMemories: jest.fn(), onConfirmPendingMemories: jest.fn(), onRejectPendingMemories: jest.fn(),
  onToggleMemory: jest.fn(), onDeleteMemory: jest.fn(), renderDebugStat: () => null, renderItemRow: () => null,
}

it('explicitly clears native busy state when a memory review is cancelled or finishes', async () => {
  const screen = await render(<MemoryReviewSection {...props} confirmingMemories />)
  const labels = [
    'contextPanel.confirmFilteredPendingMemoriesTitle',
    'contextPanel.rejectFilteredPendingMemoriesTitle',
    'contextPanel.confirmPendingMemoriesTitle',
  ]
  for (const label of labels) {
    expect(screen.getByLabelText(label).props.accessibilityState.busy).toBe(true)
    expect(screen.getByLabelText(label)).toBeDisabled()
  }
  await screen.rerender(<MemoryReviewSection {...props} confirmingMemories={false} />)
  for (const label of labels) {
    // Omitting busy does not reliably clear Android's previously announced state.
    expect(screen.getByLabelText(label).props.accessibilityState?.busy).toBe(false)
    expect(screen.getByLabelText(label)).not.toBeDisabled()
  }
})

it.each([
  ['memory-review-disclosure', 'memory-review-summary'],
  ['memory-filter-disclosure', 'memory-status-focus'],
])('honors an explicit close of %s even with active review/search filters', async (toggle, contents) => {
  const screen = await render(<MemoryReviewSection {...props} />)
  expect(screen.getByTestId(toggle).props.accessibilityState.expanded).toBe(true)
  expect(screen.getByTestId(contents)).toBeTruthy()
  await fireEvent.press(screen.getByTestId(toggle))
  expect(screen.queryByTestId(contents)).toBeNull()
  await screen.rerender(<MemoryReviewSection {...props} memoryFilter="Updated query" />)
  expect(screen.getByTestId(toggle).props.accessibilityState.expanded).toBe(false)
  await fireEvent.press(screen.getByTestId(toggle))
  expect(screen.getByTestId(contents)).toBeTruthy()
  expect(props.onResetMemoryFilters).not.toHaveBeenCalled()
})
