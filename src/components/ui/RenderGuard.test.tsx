import { act, fireEvent, render } from '@testing-library/react-native'
import * as Clipboard from 'expo-clipboard'
import { RenderGuard } from './RenderGuard'

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }))
jest.mock('@/services/runtimeHealthLog', () => ({ logRenderError: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal',
}) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 1 } }))
jest.mock('@/components/ui/isle', () => {
  const { View: MockView, Pressable: MockPressable, Text: MockText } = require('react-native')
  return {
    IslePanel: ({ children }: any) => <MockView>{children}</MockView>,
    IsleButton: ({ label, ...props }: any) => <MockPressable accessibilityRole="button" accessibilityLabel={label} {...props}><MockText>{label}</MockText></MockPressable>,
  }
})

function BrokenContent(): never { throw new Error('fixture render failure') }
function fallback(text = 'Original source') {
  return <RenderGuard fallbackText={text}><BrokenContent /></RenderGuard>
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

it.each(['success', 'false', 'reject'] as const)('shows only a verified fallback copy outcome: %s', async outcome => {
  if (outcome === 'reject') jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('clipboard denied'))
  else jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(outcome === 'success')
  const screen = await render(fallback())
  await fireEvent.press(screen.getByTestId('render-guard-copy'))
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Original source')
  if (outcome === 'success') expect(screen.getByRole('button', { name: 'common.copied' })).toBeTruthy()
  else {
    expect(screen.getByText('common.copyFailed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'common.copied' })).toBeNull()
  }
})

it('locks a pending copy and does not confirm it after the raw source changes', async () => {
  let finish!: (copied: boolean) => void
  jest.mocked(Clipboard.setStringAsync).mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve }))
  const screen = await render(fallback())
  await fireEvent.press(screen.getByTestId('render-guard-copy'))
  await fireEvent.press(screen.getByTestId('render-guard-copy'))
  expect(screen.getByTestId('render-guard-copy')).toBeDisabled()
  expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1)
  await screen.rerender(fallback('New original source'))
  await act(async () => { finish(true) })
  expect(screen.queryByRole('button', { name: 'common.copied' })).toBeNull()
  expect(screen.getByTestId('render-guard-copy')).not.toBeDisabled()
})

it('does not offer a copy action for a whitespace-only raw source', async () => {
  const screen = await render(fallback('   '))
  expect(screen.queryByTestId('render-guard-copy')).toBeNull()
})
