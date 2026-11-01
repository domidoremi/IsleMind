import { fireEvent, render } from '@testing-library/react-native'
import { ChatPersistentHeader } from './ChatPersistentHeader'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/navigation/AnimatedNavigationTrigger', () => ({ useNavigationTrigger: (trigger: unknown) => ({ trigger, active: false, running: false }) }))
jest.mock('@/components/navigation/AnimatedNavigationIcon', () => ({ AnimatedNavigationIcon: () => null }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('./theme-surfaces/ChatThemeSurfaces', () => ({ ChatChromeThemeSurface: require('react-native').View }))
jest.mock('@/components/ui/isle', () => ({ ISLE_MIN_TOUCH_TARGET: 44, IsleOverlayPressable: require('react-native').Pressable }))

it.each(CANONICAL_THEME_IDS)('names an empty model control in %s without implying that a model is available', async family => {
  const open = jest.fn()
  const view = await render(<ChatPersistentHeader themeId={family} colors={getColors('light', family)}
    title="" subtitle="New conversation" modelAccessibilityLabel="Model: "
    leadingGlyph="conversation" leadingLabel="History" onLeadingPress={jest.fn()} onModelPress={open}
    onNewConversation={jest.fn()} onSettings={jest.fn()} />)
  expect(view.getByTestId('chat-model-title')).toHaveTextContent('chat.selectModel')
  const button = view.getByTestId('chat-model-control')
  expect(button.props.accessibilityLabel).toBe('chat.model: chat.selectModel')
  await fireEvent.press(button)
  expect(open).toHaveBeenCalledTimes(1)
})

it('keeps a real model name and its reviewed accessibility description', async () => {
  const view = await render(<ChatPersistentHeader themeId="minimal" colors={getColors('light', 'minimal')}
    title="Selected model" modelAccessibilityLabel="Selected model from a local provider"
    leadingGlyph="conversation" leadingLabel="History" onLeadingPress={jest.fn()} onModelPress={jest.fn()}
    onNewConversation={jest.fn()} onSettings={jest.fn()} />)
  expect(view.getByTestId('chat-model-title')).toHaveTextContent('Selected model')
  expect(view.getByTestId('chat-model-control').props.accessibilityLabel).toBe('Selected model from a local provider')
})
