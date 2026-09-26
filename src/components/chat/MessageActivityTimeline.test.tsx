import { StyleSheet } from 'react-native'
import { fireEvent, render, within } from '@testing-library/react-native'
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
jest.mock('moti', () => ({ MotiView: () => null }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

const rows: MessageActivityRow[] = [
  { id: 'prepare', kind: 'preparing', state: 'done', details: [] },
  { id: 'think', kind: 'thinking', state: 'done', details: [{ kind: 'summary', text: 'Compared three sources.' }] },
  { id: 'command', kind: 'command', subject: 'exec_command', state: 'running', details: [{ kind: 'input', text: 'echo hello' }] },
]
const props = { rows, maxHeight: 220, motion: 'none' as const }
beforeAll(async () => { await i18n.init({ lng: 'zh-CN', resources: { en: { translation: en }, ja: { translation: ja }, 'zh-CN': { translation: zhCN } } }) })
beforeEach(() => { mockT = i18n.getFixedT('zh-CN'); mockTheme = 'minimal' })

it('shows a failed activity and its error without requiring expansion', async () => {
  const view = await render(<MessageActivityTimeline {...props} rows={[{
    ...rows[2], state: 'error', details: [{ kind: 'output', text: 'Command exited with code 2' }],
  }]} />)
  expect(view.getByText('使用 exec_command 运行命令 · 失败')).toBeTruthy()
  expect(view.getByText('Command exited with code 2')).toBeTruthy()
  expect(view.queryByText('已使用 exec_command 运行命令')).toBeNull()
})

it('shows separate activity rows immediately and expands only each row’s own content', async () => {
  const view = await render(<MessageActivityTimeline {...props} />)
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
})

it('preserves disclosure identity across live completion and does not open new activities', async () => {
  const view = await render(<MessageActivityTimeline {...props} />)
  await fireEvent.press(view.getByRole('button', { name: '正在使用 exec_command 运行命令' }))
  const completed: MessageActivityRow = { ...rows[2], state: 'done', details: [...rows[2].details, { kind: 'output', text: 'hello' }] }
  await view.rerender(<MessageActivityTimeline {...props} rows={[rows[0], rows[1], completed, { ...rows[2], id: 'second-command', subject: 'bash' }]} />)
  expect(view.getByRole('button', { name: '已使用 exec_command 运行命令' }).props.accessibilityState).toMatchObject({ expanded: true, busy: false })
  expect(view.getByText('hello')).toBeTruthy()
  expect(view.queryByTestId('message-activity-details-second-command')).toBeNull()
})

it('gives only meaningful disclosures a button and keeps physical touch targets accessible', async () => {
  const view = await render(<MessageActivityTimeline {...props} />)
  expect(view.getAllByRole('button')).toHaveLength(2)
  for (const button of view.getAllByRole('button')) {
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44)
    expect(button.props.accessibilityHint).toBe('展开此项详情')
  }
})

it('keeps a confirmation notice separate from successfully completed work', async () => {
  const view = await render(<MessageActivityTimeline {...props} notice="需要确认后继续" />)
  expect(view.getByText('需要确认后继续')).toBeTruthy()
  expect(view.queryByText('生成 · 需要确认后继续')).toBeNull()
  expect(view.getByText('回复准备完成')).toBeTruthy()
})

it.each(['en', 'ja', 'zh-CN'])('localizes labels and detail toggles in %s', async locale => {
  mockT = i18n.getFixedT(locale)
  const view = await render(<MessageActivityTimeline {...props} />)
  const button = view.getByRole('button', { name: mockT('messageBubble.activity.thinking.done') })
  await fireEvent.press(button)
  expect(view.getByText(mockT('messageBubble.activity.detail.summary'))).toBeTruthy()
  expect(button.props.accessibilityHint).toBe(mockT('messageBubble.activity.collapse'))
})

it.each(['minimal', 'material', 'monet', 'animal-island-ui', 'liquid-glass'])('renders the same independent disclosures in theme %s', async theme => {
  mockTheme = theme
  const view = await render(<MessageActivityTimeline {...props} />)
  await fireEvent.press(view.getByRole('button', { name: '思考已完成' }))
  expect(view.getByText('Compared three sources.')).toBeTruthy()
})
