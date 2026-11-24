import { act, fireEvent, render } from '@testing-library/react-native'
import Markdown from 'react-native-markdown-display'
import { GuideReader } from './SettingsHelp'

let mockAnchorY = 125
let mockDeferMeasurement = false
let mockDimensions = { width: 844, height: 390, scale: 1, fontScale: 1 }
const mockContent = {}
const mockScrollTo = jest.fn()
const mockRelativeNodes: unknown[] = []
const mockMeasurements: { finish: (x: number, y: number, width: number, height: number) => void; y: number }[] = []

jest.mock('react-native', () => {
  const original = jest.requireActual('react-native')
  const React = require('react')
  const View = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => props.testID === 'guide-content' ? mockContent : ({
      measureLayout(relative: unknown, finish: (x: number, y: number, width: number, height: number) => void) {
        mockRelativeNodes.push(relative)
        if (mockDeferMeasurement) mockMeasurements.push({ finish, y: mockAnchorY })
        else finish(0, mockAnchorY, 720, 300)
      },
      measureInWindow() {},
    }), [])
    return <original.View {...props} />
  })
  const ScrollView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }), [])
    return <original.ScrollView {...props} />
  })
  return Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(original),
    View: { value: View }, ScrollView: { value: ScrollView },
    useWindowDimensions: { value: () => mockDimensions },
  })
})
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }),
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  return {
    IsleScreen: View, IslePressable: Pressable, IsleSearchField: TextInput,
    IsleButton: ({ label, onPress }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>,
  }
})
jest.mock('@/components/ui/isle/ThemeMotion', () => ({
  IsleMotionFrame: ({ children }: any) => {
    const { View } = require('react-native')
    return <View>{children}</View>
  },
}))
jest.mock('@/presentation/layout/useKeyboardScrollViewport', () => ({
  useKeyboardViewportInset: () => ({ frameRef: require('react').useRef(null), onFrameLayout() {}, bottomInset: 0 }),
}))
jest.mock('react-native-markdown-display', () => ({
  __esModule: true,
  MarkdownIt: jest.requireActual('react-native-markdown-display').MarkdownIt,
  default: jest.fn(({ children }: any) => {
    const { Text } = require('react-native')
    return <Text>{children}</Text>
  }),
}))

beforeEach(() => {
  mockAnchorY = 125
  mockDeferMeasurement = false
  mockDimensions = { width: 844, height: 390, scale: 1, fontScale: 1 }
  mockScrollTo.mockClear()
  mockRelativeNodes.length = 0
  mockMeasurements.length = 0
})

async function editingChapter() {
  const screen = await render(<GuideReader initialSlug="models" onClose={() => undefined} />)
  const block = screen.container.queryAll(node =>
    typeof node.props.onLayout === 'function'
    && node.props.children?.type === Markdown
    && String(node.props.children.props.children).includes('## Connection drafts and save failures'),
  )[0]
  expect(block).toBeDefined()
  await fireEvent(block, 'layout', { nativeEvent: { layout: { x: 0, y: 125, width: 720, height: 300 } } })
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.chapterContents' }))
  mockScrollTo.mockClear()
  return screen
}

it('measures the requested heading after contents and viewport reflow without requiring another block layout event', async () => {
  const screen = await editingChapter()
  mockAnchorY = 582
  mockDimensions = { width: 320, height: 844, scale: 1, fontScale: 2 }
  await screen.rerender(<GuideReader initialSlug="models" onClose={() => undefined} />)
  await fireEvent.press(screen.getByRole('button', { name: 'Connection drafts and save failures' }))
  expect(mockRelativeNodes.at(-1)).toBe(mockContent)
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 582, animated: false })
})

it('applies changed external anchors to an already mounted chapter using current content measurements', async () => {
  const screen = await render(<GuideReader initialSlug="models" onClose={() => undefined} />)
  mockScrollTo.mockClear()
  mockAnchorY = 780
  await screen.rerender(<GuideReader initialSlug="models" initialAnchor="editing" onClose={() => undefined} />)
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 780, animated: false })
  mockAnchorY = 222
  await screen.rerender(<GuideReader initialSlug="models" initialAnchor="generation" onClose={() => undefined} />)
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 222, animated: false })
})

it('ignores an older heading measurement after another anchor has been requested', async () => {
  const screen = await editingChapter()
  mockDeferMeasurement = true
  mockAnchorY = 900
  await fireEvent.press(screen.getByRole('button', { name: 'Connection drafts and save failures' }))
  mockAnchorY = 225
  await fireEvent.press(screen.getByRole('button', { name: 'Generation parameters' }))
  expect(mockMeasurements).toHaveLength(2)
  const [older, current] = mockMeasurements
  await act(() => older.finish(0, older.y, 720, 300))
  expect(mockScrollTo).not.toHaveBeenCalled()
  await act(() => current.finish(0, current.y, 720, 300))
  expect(mockScrollTo).toHaveBeenCalledTimes(1)
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 225, animated: false })
})

it.each(['drag', 'contents', 'unmount'] as const)('does not apply a pending heading measurement after %s', async action => {
  const screen = await editingChapter()
  mockDeferMeasurement = true
  mockAnchorY = 900
  await fireEvent.press(screen.getByRole('button', { name: 'Connection drafts and save failures' }))
  expect(mockMeasurements).toHaveLength(1)
  const pending = mockMeasurements[0]
  if (action === 'drag') await fireEvent(screen.getByTestId('guide-scroll'), 'scrollBeginDrag')
  else if (action === 'contents') await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.contents' }))
  else await screen.unmount()
  mockScrollTo.mockClear()
  await act(() => pending.finish(0, pending.y, 720, 300))
  expect(mockScrollTo).not.toHaveBeenCalled()
})
