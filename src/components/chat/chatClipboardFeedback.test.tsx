import { act, fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useIsleDialog } from '@/components/ui/isle'
import { Composer } from './Composer'
import { MessageContent } from './MessageContent'

let mockMode: 'light' | 'dark' = 'light'
let mockFamily = 'minimal'

it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'])('keeps %s reply typography consistent when streaming finishes', async family => {
  mockFamily = family
  const typography = jest.requireActual('@/theme/colors').getColors('light', family).design.semantic.typography
  const content = '# Heading\n\n## Section\n\nReadable reply'
  const view = await render(<MessageContent content={content} isStreaming />)
  expect(view.getByText(content)).toHaveStyle(typography.body)
  await view.rerender(<MessageContent content={content} />)
  expect(view.getByText('Readable reply')).toHaveStyle(typography.body)
  expect(view.getByText('Heading')).toHaveStyle(typography.headline)
  expect(view.getByText('Section')).toHaveStyle(typography.title)
})

it.each(['monet', 'animal-island-ui'])('uses %s body typography in the editable composer but keeps source code monospace', async family => {
  mockFamily = family
  const typography = jest.requireActual('@/theme/colors').getColors('light', family).design.semantic.typography
  const view = await render(<Composer initialDraft="Typography draft" initialDraftKey="font-test"
    viewportHeight={844} horizontalPadding={12} safeAreaTop={0} safeAreaBottom={0} keyboardLift={0} motion="none" onSend={jest.fn()} />)
  expect(view.getByLabelText('chat.inputAccessibility')).toHaveStyle(typography.body)
  await view.unmount()
  const reply = await render(<MessageContent content={'```ts\nconst value = 2\n```'} />)
  expect(reply.getByText('const value = 2')).toHaveStyle({ fontFamily: 'monospace' })
})

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors(mockMode, mockFamily), canonicalThemeId: mockFamily }),
}))
jest.mock('@/components/ui/isle', () => ({
  IslePressable: require('react-native').Pressable,
  IsleButton: ({ label, ...props }: any) => {
    const { Pressable: MockPressable, Text } = require('react-native')
    return <MockPressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></MockPressable>
  },
  ISLE_MIN_TOUCH_TARGET: 44,
  useIsleDialog: jest.fn(),
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/ProviderBrandIcon', () => ({ ProviderBrandIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('@/components/ui/isle/ThemeExpressionSurface', () => ({ ThemeExpressionSurface: require('react-native').View }))
jest.mock('./theme-surfaces/ChatThemeSurfaces', () => ({
  MessageContentThemeSurface: require('react-native').View,
  ChatComposerThemeSurface: require('react-native').View,
}))
jest.mock('@/services/attachment', () => ({ pickDocument: jest.fn(), pickImage: jest.fn(), takePhoto: jest.fn() }))
jest.mock('./useComposerVoiceInput', () => ({ useComposerVoiceInput: () => ({ state: { phase: 'idle' } }) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
const mockQueryFiles = jest.fn(async (..._args: unknown[]) => ({ files: [{ relativePath: 'workspace/example.ts', revision: 'fixture-revision', byteLength: 12, mimeType: 'text/plain' }] }))
jest.mock('@/bootstrap/builtInWorkspaceFileRuntime', () => ({ builtInWritableWorkspaceFilePort: { queryFiles: (...args: unknown[]) => mockQueryFiles(...args) } }))

const toast = jest.fn()
const cases = ['success', 'false', 'rejection', 'throw'] as const

it('opens code files only on demand and adds a path without losing the draft or sending', async () => {
  const onSend = jest.fn()
  const view = await render(<Composer initialDraft="Please review this carefully." initialDraftKey="workspace-test"
    utilitiesOpen onSend={onSend} viewportHeight={844} horizontalPadding={12}
    safeAreaTop={0} safeAreaBottom={0} keyboardLift={0} motion="none" />)
  expect(mockQueryFiles).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'chat.codeWorkspace' }))
  expect(mockQueryFiles).toHaveBeenCalledWith({ directory: 'workspace', limit: 20, afterPath: undefined }, expect.anything())
  await fireEvent.press(view.getByRole('button', { name: 'workspace/example.ts' }))
  expect(view.getByLabelText('chat.inputAccessibility').props.value).toBe('Please review this carefully.\nworkspace/example.ts')
  expect(onSend).not.toHaveBeenCalled()
  expect(view.queryByRole('button', { name: 'workspace/example.ts' })).toBeNull()
})
function clipboardOutcome(outcome: typeof cases[number]) {
  const write = jest.mocked(Clipboard.setStringAsync)
  if (outcome === 'throw') write.mockImplementationOnce(() => { throw new Error('Clipboard unavailable') })
  else if (outcome === 'rejection') write.mockRejectedValueOnce(new Error('Clipboard unavailable'))
  else write.mockResolvedValueOnce(outcome === 'success')
}

beforeEach(() => {
  mockMode = 'light'
  mockFamily = 'minimal'
  jest.clearAllMocks()
  jest.mocked(Clipboard.setStringAsync).mockReset()
  jest.useFakeTimers()
  jest.mocked(useIsleDialog).mockReturnValue({ toast } as unknown as ReturnType<typeof useIsleDialog>)
})

it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'])('uses code-surface foregrounds for %s code labels and actions', async family => {
  for (const mode of ['light', 'dark'] as const) {
    mockMode = mode
    mockFamily = family
    const colors = jest.requireActual('@/theme/colors').getColors(mode, family)
    const view = await render(<MessageContent content={'```ts\nconst first = 1\nconst second = 2\n```'} />)
    for (const text of ['messageContent.codeBlockTitle', 'common.copy', '1', '2', 'const first = 1', 'const second = 2']) {
      expect(StyleSheet.flatten(view.getByText(text).props.style).color).toBe(colors.ui.code.text)
    }
    await view.unmount()
  }
})
afterEach(async () => {
  await act(async () => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

it.each(cases)('rich code copy reports %s instead of assuming a resolved promise means success', async (outcome) => {
  clipboardOutcome(outcome)
  const view = await render(<MessageContent content={'```js\nconst answer = 42\n```'} />)
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  const label = outcome === 'success' ? 'common.copied' : 'common.copyFailed'
  expect(view.getByRole('button', { name: label })).toBeTruthy()
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('const answer = 42\n')
  await act(async () => jest.advanceTimersByTime(1300))
  expect(view.getByRole('button', { name: 'common.copy' })).toBeTruthy()
})

it('keeps a failed rich-block action available for an immediate successful retry', async () => {
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const view = await render(<MessageContent content={'```js\nconst answer = 42\n```'} />)
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  await fireEvent.press(view.getByRole('button', { name: 'common.copyFailed' }))
  expect(view.getByRole('button', { name: 'common.copied' })).toBeTruthy()
  expect(jest.mocked(Clipboard.setStringAsync).mock.calls).toEqual([['const answer = 42\n'], ['const answer = 42\n']])
})

it.each(cases)('draft copy reports %s and preserves the full editable draft', async (outcome) => {
  clipboardOutcome(outcome)
  const draft = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n')
  const view = await render(<Composer initialDraft={draft} initialDraftKey="clipboard-test"
    viewportHeight={800} horizontalPadding={12} safeAreaTop={0} safeAreaBottom={0}
    keyboardLift={0} motion="none" onSend={jest.fn()} />)
  await fireEvent(view.getByLabelText('chat.inputAccessibility'), 'contentSizeChange', {
    nativeEvent: { contentSize: { width: 320, height: 240 } },
  })
  await fireEvent.press(view.getByRole('button', { name: 'chat.composerExpandDraft' }))
  await fireEvent.press(view.getByRole('button', { name: 'chat.composerMoreTools' }))
  await fireEvent.press(view.getByRole('button', { name: 'chat.composerCopyAll' }))
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({
    title: outcome === 'success' ? 'common.copied' : 'common.copyFailed',
    tone: outcome === 'success' ? 'mint' : 'danger',
  }))
  expect(toast).toHaveBeenCalledTimes(1)
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(draft)
  expect(view.getByLabelText('chat.inputAccessibility').props.value).toBe(draft)
})
