import { fireEvent, render } from '@testing-library/react-native'
import { Keyboard, Platform } from 'react-native'
import type { ChatOptionsDraftCommits } from './useChatOptionsDraftCommits'
import { THEME_MOTION_DURATIONS } from '@/theme/themeTokens'
import { ChatAiConfigurationSheet } from './ChatAiConfigurationSheet'

const mockPendingParameterCommit = jest.fn()
afterEach(() => { jest.restoreAllMocks(); mockPendingParameterCommit.mockReset() })

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: require('@/theme/colors').getColors('dark', 'material'), canonicalThemeId: 'material',
}) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'full' }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/utils/lazyLoad', () => {
  const React = require('react')
  const { Pressable: MockPressable, View } = require('react-native')
  return {
    LazyLoadingFallback: () => null,
    createLazyComponent: () => (props: { onManageProviders?: () => void; onClose?: () => void; draftCommits?: ChatOptionsDraftCommits }) => {
      React.useLayoutEffect(() => props.draftCommits?.register(mockPendingParameterCommit), [props.draftCommits])
      return <View>
        {props.onManageProviders ? <MockPressable accessibilityLabel="Providers" onPress={props.onManageProviders} /> : null}
        <MockPressable accessibilityLabel="Close" onPress={props.onClose} />
      </View>
    },
  }
})

it('keeps the sheet entrance mounted through configuration changes and closes immediately', async () => {
  const onClose = jest.fn()
  const tree = (visible = true) => <ChatAiConfigurationSheet
    visible={visible} conversation={{} as never} provider={undefined} settings={{} as never}
    switchableProviders={[]} onSwitchModel={jest.fn()} onClose={onClose}
  />
  const screen = await render(tree())
  const sheet = screen.getByTestId('chat-ai-configuration-motion')
  expect(sheet.props.from.opacity).toBe(0.65)
  expect(sheet.props.transition.duration).toBe(THEME_MOTION_DURATIONS.material.panel)
  const transition = sheet.props.transition
  await fireEvent.press(screen.getByLabelText('Providers'))
  expect(screen.getByTestId('chat-ai-provider-management-panel')).toBeTruthy()
  expect(screen.getByTestId('chat-ai-configuration-motion')).toBe(sheet)
  expect(sheet.props.transition).toBe(transition)
  await fireEvent.press(screen.getByLabelText('Close'))
  expect(onClose).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByLabelText('Close'))
  expect(onClose).toHaveBeenCalledTimes(1)
  await screen.rerender(tree(false))
  expect(screen.queryByTestId('chat-ai-configuration-motion')).toBeNull()
})


it('finishes registered numeric drafts and clears focus before a keyboard-free Android back closes the sheet', async () => {
  const events: string[] = []
  jest.replaceProperty(Platform, 'OS', 'android')
  const keyboardVisible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true)
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => { events.push('blur') })
  mockPendingParameterCommit.mockImplementation(() => { events.push('save') })
  const onClose = jest.fn(() => { events.push('close') })
  const screen = await render(<ChatAiConfigurationSheet visible conversation={{} as never}
    provider={undefined} settings={{} as never} switchableProviders={[]} onSwitchModel={jest.fn()} onClose={onClose} />)
  await fireEvent(screen.getByTestId('chat-ai-configuration-panel'), 'requestClose')
  expect(events).toEqual(['blur'])
  expect(onClose).not.toHaveBeenCalled()
  keyboardVisible.mockReturnValue(false)
  await fireEvent(screen.getByTestId('chat-ai-configuration-panel'), 'requestClose')
  expect(events).toEqual(['blur', 'save', 'blur', 'close'])
  expect(mockPendingParameterCommit).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})
