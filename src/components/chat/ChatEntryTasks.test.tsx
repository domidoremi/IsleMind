import { fireEvent, render } from '@testing-library/react-native'
import { ChatEntryTasks } from './ChatEntryTasks'
import { CHAT_PRESENTATION_CATALOG } from '@/presentation/features/chat/chatPresentationCatalog'
import type { CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: require('@/theme/colors').getColors('light', mockFamily), canonicalThemeId: mockFamily,
}) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({
  IsleMotionFrame: require('react-native').View,
  IslePressable: require('react-native').Pressable,
  IsleButton: ({ label, ...props }: any) => {
    const { Pressable, Text } = require('react-native')
    return <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable>
  },
}))

function props() {
  return {
    title: 'Start with an idea', modelTitle: 'Fixture model', providerName: 'Fixture provider',
    ready: false, hasProvider: false, draftPresence: 'empty' as const,
    onStarter: jest.fn(), onConfigure: jest.fn(), onHistory: jest.fn(), onDocuments: jest.fn(),
  }
}
beforeEach(() => { mockFamily = 'minimal' })

it('offers three independent tasks before connection and prepares only the chosen starting point on explicit activation', async () => {
  const input = props()
  const screen = await render(<ChatEntryTasks {...input} />)
  expect(screen.getAllByRole('radio')).toHaveLength(3)
  await fireEvent.press(screen.getByTestId('chat-entry-task-draft'))
  expect(screen.getByTestId('chat-entry-task-draft').props.accessibilityState.checked).toBe(true)
  expect(screen.getByTestId('chat-entry-task-description')).toHaveTextContent(CHAT_PRESENTATION_CATALOG.starters[2].descriptionKey)
  expect(input.onStarter).not.toHaveBeenCalled()
  expect(input.onConfigure).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByTestId('chat-entry-prepare'))
  expect(input.onStarter).toHaveBeenCalledTimes(1)
  expect(input.onStarter).toHaveBeenCalledWith(CHAT_PRESENTATION_CATALOG.starters[2])
  expect(input.onConfigure).not.toHaveBeenCalled()
})

it('keeps task selection across themes and refuses to overwrite a restored or existing draft', async () => {
  const input = props()
  const screen = await render(<ChatEntryTasks {...input} draftPresence="loading" />)
  const choices = screen.getByTestId('chat-entry-task-choices')
  await fireEvent.press(screen.getByTestId('chat-entry-task-analyze'))
  expect(screen.getByTestId('chat-entry-prepare')).toBeDisabled()
  for (const family of ['monet', 'material', 'liquid-glass', 'animal-island-ui'] as const) {
    mockFamily = family
    await screen.rerender(<ChatEntryTasks {...input} draftPresence="draft" />)
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByTestId('chat-entry-task-panel', { includeHiddenElements: true })).toHaveStyle({ display: 'none' })
    expect(screen.getByTestId('chat-entry-task-choices', { includeHiddenElements: true })).toBe(choices)
    await fireEvent.press(screen.getByTestId('chat-entry-starting-points-toggle'))
    expect(screen.getByTestId('chat-entry-task-analyze').props.accessibilityState.checked).toBe(true)
    expect(screen.getByTestId('chat-entry-prepare')).toBeDisabled()
    await fireEvent.press(screen.getByTestId('chat-entry-starting-points-toggle'))
  }
  await fireEvent.press(screen.getByTestId('chat-entry-starting-points-toggle'))
  await fireEvent.press(screen.getByTestId('chat-entry-prepare'))
  expect(input.onStarter).not.toHaveBeenCalled()
})

it('keeps continuation actions visible while writing and retains hidden starting-point selection', async () => {
  const input = props()
  const screen = await render(<ChatEntryTasks {...input} />)
  const choices = screen.getByTestId('chat-entry-task-choices')
  await fireEvent.press(screen.getByTestId('chat-entry-task-draft'))
  await screen.rerender(<ChatEntryTasks {...input} composing />)
  expect(screen.getByTestId('chat-entry-title')).toHaveTextContent('taskWorkspace.home.draftTitle')
  expect(screen.getByTestId('chat-entry-history')).toBeVisible()
  expect(screen.getByTestId('chat-entry-documents')).toBeVisible()
  expect(screen.queryAllByRole('radio')).toHaveLength(0)
  expect(input.onStarter).not.toHaveBeenCalled()
  await screen.rerender(<ChatEntryTasks {...input} />)
  expect(screen.getByTestId('chat-entry-task-choices')).toBe(choices)
  expect(screen.getByTestId('chat-entry-task-draft').props.accessibilityState.checked).toBe(true)
})

it('opens continuation and connection destinations without preparing a new draft', async () => {
  const input = props()
  const screen = await render(<ChatEntryTasks {...input} ready />)
  await fireEvent.press(screen.getByTestId('chat-entry-history'))
  await fireEvent.press(screen.getByTestId('chat-entry-documents'))
  await fireEvent.press(screen.getByTestId('chat-entry-connection'))
  expect(input.onHistory).toHaveBeenCalledTimes(1)
  expect(input.onDocuments).toHaveBeenCalledTimes(1)
  expect(input.onConfigure).toHaveBeenCalledTimes(1)
  expect(input.onStarter).not.toHaveBeenCalled()
})
