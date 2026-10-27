import { StyleSheet } from 'react-native'
import { fireEvent, render, within } from '@testing-library/react-native'
import { MotiView } from 'moti'
import { createInstance, type TFunction } from 'i18next'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import zhCN from '@/i18n/resources/zh-CN.json'
import { MessageActivityTimeline } from './MessageActivityTimeline'
import type { MessageActivityRow } from './messageActivityRows'

let mockT: TFunction
let mockTheme = 'minimal'
const i18n = createInstance()
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (...args: Parameters<TFunction>) => mockT(...args) }) }))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors('light', mockTheme), canonicalThemeId: mockTheme }),
}))
jest.mock('moti', () => ({ MotiView: jest.fn(() => null) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

const rows: MessageActivityRow[] = [
  { id: 'prepare', kind: 'preparing', state: 'done', details: [] },
  { id: 'think', kind: 'thinking', state: 'done', details: [{ kind: 'summary', text: 'Compared three sources.' }] },
  { id: 'command', kind: 'command', subject: 'exec_command', state: 'running', details: [{ kind: 'input', text: 'echo hello' }] },
]
const props = { rows, maxHeight: 220, motion: 'none' as const }
beforeAll(async () => { await i18n.init({ lng: 'zh-CN', resources: { en: { translation: en }, ja: { translation: ja }, 'zh-CN': { translation: zhCN } } }) })
beforeEach(() => { mockT = i18n.getFixedT('zh-CN'); mockTheme = 'minimal' })

it('keeps durable pause attention visible and static even with an obsolete active flag', async () => {
  mockTheme = 'monet'
  const shimmer = jest.mocked(MotiView)
  shimmer.mockClear()
  const interval = jest.spyOn(globalThis, 'setInterval')
  const paused: MessageActivityRow[] = [
    { id: 'prepare', kind: 'preparing', state: 'done', details: [] },
    { id: 'pause', kind: 'paused', state: 'paused', details: [{ kind: 'summary', text: 'Capacity admission is paused.' }] },
  ]
  let view: Awaited<ReturnType<typeof render>> | undefined
  try {
    view = await render(<MessageActivityTimeline {...props} rows={paused} active replyStarted motion="full" />)
    expect(view.getByTestId('message-activity-row-pause')).toBeTruthy()
    expect(view.getAllByText(mockT('agentTasks.status.paused')).length).toBeGreaterThan(0)
    expect(view.getByTestId('message-activity-toggle').props.accessibilityState.busy).toBe(false)
    expect(shimmer).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
  } finally {
    await view?.unmount()
    interval.mockRestore()
  }
})

it.each(['reduced', 'none'] as const)('stops status shimmer and dot cycling with %s motion', async motion => {
  mockTheme = 'monet'
  jest.useFakeTimers()
  const interval = jest.spyOn(globalThis, 'setInterval')
  const clear = jest.spyOn(globalThis, 'clearInterval')
  const shimmer = jest.mocked(MotiView)
  shimmer.mockClear()
  let view: Awaited<ReturnType<typeof render>> | undefined
  try {
    view = await render(<MessageActivityTimeline {...props} motion="full" />)
    expect(shimmer).toHaveBeenCalled()
    expect(shimmer.mock.calls[0][0].transition).toEqual(expect.objectContaining({ loop: true }))
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 520)
    const cycleTimer = interval.mock.results[0].value
    interval.mockClear()
    shimmer.mockClear()

    await view.rerender(<MessageActivityTimeline {...props} motion={motion} />)
    expect(shimmer).not.toHaveBeenCalled()
    expect(clear).toHaveBeenCalledWith(cycleTimer)
    expect(interval).not.toHaveBeenCalled()
    expect(view.getByText('正在使用 exec_command 运行命令...')).toBeTruthy()
  } finally {
    await view?.unmount()
    interval.mockRestore()
    clear.mockRestore()
    jest.useRealTimers()
  }
})

it('shows actual work before the answer, then collapses once the reply starts', async () => {
  const view = await render(<MessageActivityTimeline {...props} active replyStarted={false} />)
  expect(view.getByTestId('message-activity-row-command')).toBeTruthy()
  expect(view.getByTestId('message-activity-toggle').props.accessibilityState.expanded).toBe(true)
  await view.rerender(<MessageActivityTimeline {...props} active replyStarted />)
  expect(view.queryByTestId('message-activity-row-command')).toBeNull()
  await fireEvent.press(view.getByTestId('message-activity-toggle'))
  await view.rerender(<MessageActivityTimeline {...props} active replyStarted rows={[...rows, { ...rows[2], id: 'later' }]} />)
  expect(view.getByTestId('message-activity-row-later')).toBeTruthy()
  await view.rerender(<MessageActivityTimeline {...props} replyStarted />)
  expect(view.getByTestId('message-activity-toggle').props.accessibilityState.expanded).toBe(true)
})

it('shows a failed activity and its error without requiring expansion', async () => {
  const view = await render(<MessageActivityTimeline {...props} rows={[{
    ...rows[2], state: 'error', details: [{ kind: 'output', text: 'Command exited with code 2' }],
  }]} />)
  expect(view.getByText('使用 exec_command 运行命令 · 失败')).toBeTruthy()
  expect(view.getByText('Command exited with code 2')).toBeTruthy()
  expect(view.queryByText('已使用 exec_command 运行命令')).toBeNull()
})

it('keeps history unmounted by default and expands only each row’s own content on demand', async () => {
  const view = await render(<MessageActivityTimeline {...props} />)
  expect(view.queryByTestId('message-activity-row-prepare')).toBeNull()
  expect(view.queryByTestId('message-activity-row-think')).toBeNull()
  expect(view.queryByTestId('message-activity-row-command')).toBeNull()
  expect(view.getByTestId('message-activity-toggle').props.accessibilityState.expanded).toBe(false)
  expect(view.getByTestId('message-activity-toggle').props.accessibilityLabel).not.toContain('{{')
  await fireEvent.press(view.getByTestId('message-activity-toggle'))
  expect(view.getByText('回复准备完成')).toBeTruthy()
  expect(view.getByText('思考已完成')).toBeTruthy()
  expect(view.queryByText('运行过程')).toBeNull()
  expect(view.queryByText('Compared three sources.')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: '思考已完成' }))
  const thinking = within(view.getByTestId('message-activity-details-think'))
  expect(thinking.getByText('思考摘要')).toBeTruthy()
  expect(thinking.getByText('Compared three sources.')).toBeTruthy()
  expect(thinking.queryByText('回复准备完成')).toBeNull()
  expect(view.queryByText('echo hello')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: '正在使用 exec_command 运行命令' }))
  expect(view.getByText('echo hello')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: '思考已完成' }))
  expect(view.queryByText('Compared three sources.')).toBeNull()
  expect(view.getByText('echo hello')).toBeTruthy()
  await fireEvent.press(view.getByTestId('message-activity-toggle'))
  expect(view.queryByTestId('message-activity-row-command')).toBeNull()
  expect(view.queryByText('echo hello')).toBeNull()
})

it('preserves disclosure identity across live completion and does not open new activities', async () => {
  const view = await render(<MessageActivityTimeline {...props} />)
  await fireEvent.press(view.getByTestId('message-activity-toggle'))
  await fireEvent.press(view.getByRole('button', { name: '正在使用 exec_command 运行命令' }))
  const completed: MessageActivityRow = { ...rows[2], state: 'done', details: [...rows[2].details, { kind: 'output', text: 'hello' }] }
  await view.rerender(<MessageActivityTimeline {...props} rows={[rows[0], rows[1], completed, { ...rows[2], id: 'second-command', subject: 'bash' }]} />)
  expect(within(view.getByTestId('message-activity-row-command')).getByRole('button').props.accessibilityState).toMatchObject({ expanded: true, busy: false })
  expect(view.getByText('hello')).toBeTruthy()
  expect(view.queryByTestId('message-activity-details-second-command')).toBeNull()
})

it('gives only meaningful disclosures a button and keeps physical touch targets accessible', async () => {
  const view = await render(<MessageActivityTimeline {...props} />)
  expect(view.getAllByRole('button')).toHaveLength(1)
  expect(view.getByTestId('message-activity-toggle').props.accessibilityHint).toBe('展开运行过程')
  await fireEvent.press(view.getByTestId('message-activity-toggle'))
  expect(view.getAllByRole('button')).toHaveLength(3)
  for (const button of view.getAllByRole('button')) {
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44)
  }
})

it('keeps a confirmation notice separate from successfully completed work', async () => {
  const view = await render(<MessageActivityTimeline {...props} notice="需要确认后继续" />)
  expect(view.getByText('需要确认后继续')).toBeTruthy()
  expect(view.queryByText('生成 · 需要确认后继续')).toBeNull()
  expect(view.queryByText('回复准备完成')).toBeNull()
})

it('shows cancellation in the compact summary without mounting normal history', async () => {
  const view = await render(<MessageActivityTimeline {...props} rows={[rows[0],
    { id: 'terminal', kind: 'cancelled', state: 'cancelled', details: [] },
  ]} />)
  expect(view.getByTestId('message-activity-toggle').props.accessibilityLabel).toContain('已取消')
  expect(view.getByTestId('message-activity-toggle').props.accessibilityState.expanded).toBe(false)
  expect(view.queryByTestId('message-activity-row-prepare')).toBeNull()
  expect(view.queryByTestId('message-activity-row-terminal')).toBeNull()
})

it.each(['en', 'ja', 'zh-CN'])('localizes labels and detail toggles in %s', async locale => {
  mockT = i18n.getFixedT(locale)
  const view = await render(<MessageActivityTimeline {...props} />)
  await fireEvent.press(view.getByTestId('message-activity-toggle'))
  const button = view.getByRole('button', { name: mockT('messageBubble.activity.thinking.done') })
  await fireEvent.press(button)
  expect(view.getByText(mockT('messageBubble.activity.detail.summary'))).toBeTruthy()
  expect(button.props.accessibilityHint).toBe(mockT('messageBubble.activity.collapse'))
})

it.each(['minimal', 'material', 'monet', 'animal-island-ui', 'liquid-glass'])('renders the same independent disclosures in theme %s', async theme => {
  mockTheme = theme
  const view = await render(<MessageActivityTimeline {...props} />)
  await fireEvent.press(view.getByTestId('message-activity-toggle'))
  await fireEvent.press(view.getByRole('button', { name: '思考已完成' }))
  expect(view.getByText('Compared three sources.')).toBeTruthy()
})

it('does not render empty history or unfold when new work arrives', async () => {
  const view = await render(<MessageActivityTimeline {...props} rows={[]} />)
  expect(view.queryByTestId('message-activity-timeline')).toBeNull()
  await view.rerender(<MessageActivityTimeline {...props} />)
  await view.rerender(<MessageActivityTimeline {...props} rows={[...rows, { ...rows[2], id: 'later' }]} />)
  expect(view.getByTestId('message-activity-toggle').props.accessibilityState.expanded).toBe(false)
  expect(view.queryByTestId('message-activity-row-later')).toBeNull()
})

it('keeps a real waiting or uncertain operation visible without opening unrelated history', async () => {
  const view = await render(<MessageActivityTimeline {...props} rows={[...rows,
    { id: 'approval', kind: 'edit', state: 'waiting', subject: 'draft.txt', details: [] },
    { id: 'partial', kind: 'tool', state: 'incomplete', subject: 'copy', details: [] },
  ]} />)
  expect(view.getByTestId('message-activity-row-approval')).toBeTruthy()
  expect(view.getByTestId('message-activity-row-partial')).toBeTruthy()
  expect(view.queryByTestId('message-activity-row-prepare')).toBeNull()
})


it('summarizes successful completion, and never counts failed or cancelled work as completed', async () => {
  const done = rows.map(row => ({ ...row, state: 'done' as const }))
  const view = await render(<MessageActivityTimeline {...props} rows={done} />)
  expect(view.getByText('已完成 3 项')).toBeTruthy()
  expect(view.queryByText(/运行过程/)).toBeNull()
  await view.rerender(<MessageActivityTimeline {...props} rows={[...done.slice(0, 2), { ...done[2], state: 'error' }]} />)
  expect(view.getByText('1 项失败')).toBeTruthy()
  expect(view.queryByText('已完成 3 项')).toBeNull()
  await view.rerender(<MessageActivityTimeline {...props} rows={[...done.slice(0, 2), { ...done[2], state: 'cancelled' }]} />)
  expect(view.getByTestId('message-activity-toggle').props.accessibilityLabel).toContain('已取消')
})

it('does not announce completion while the live reply is between recorded stages', async () => {
  const done = rows.map(row => ({ ...row, state: 'done' as const }))
  const view = await render(<MessageActivityTimeline {...props} rows={done} active />)
  expect(view.getByTestId('message-activity-toggle').props.accessibilityLabel).toContain(mockT('messageBubble.activity.working.active'))
  expect(view.getByTestId('message-activity-toggle').props.accessibilityState.busy).toBe(true)
  await view.rerender(<MessageActivityTimeline {...props} rows={done} active replyStarted />)
  expect(view.getByTestId('message-activity-toggle').props.accessibilityLabel).toContain(mockT('messageBubble.activity.generating.active'))
  expect(view.queryByTestId('message-activity-row-command')).toBeNull()
  await view.rerender(<MessageActivityTimeline {...props} rows={done} replyStarted />)
  expect(view.getByText('已完成 3 项')).toBeTruthy()
})
