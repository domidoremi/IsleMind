import { useEffect, useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Platform, TextInput } from 'react-native'
import { WorkspaceTabs } from './WorkspaceTabs'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: jest.requireActual('@/theme/colors').getColors(mockMode, mockFamily), canonicalThemeId: mockFamily,
}) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/PageFeedback', () => ({ PageFeedbackIndicator: () => null }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 2 } }))
jest.mock('@/components/ui/isle', () => {
  const { View: MockView, Pressable: MockPressable } = jest.requireActual('react-native')
  return { IsleScreen: MockView, IslePressable: MockPressable }
})
jest.mock('@/components/ui/isle/GlassSurface', () => {
  const MockView = jest.requireActual('react-native').View
  return { GlassSurface: ({ children, colors, enabled, variant, shadow, ...props }: any) => <MockView {...props}>{children}</MockView> }
})
jest.mock('moti', () => ({ MotiView: jest.requireActual('react-native').View }))

const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS')!
beforeEach(() => {
  mockFamily = 'minimal'; mockMode = 'light'
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' })
  jest.spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 320, height: 900, scale: 1, fontScale: 2 })
})
afterEach(() => {
  Object.defineProperty(Platform, 'OS', platformDescriptor)
  jest.restoreAllMocks()
})
const tabs = [{ value: 'a', label: 'Connection' }, { value: 'b', label: 'Disabled', disabled: true }, { value: 'c', label: 'Requests' }] as const

it('uses one keyboard stop and skips unavailable choices when navigating or wrapping', async () => {
  const select = jest.fn()
  const focus = [jest.fn(), jest.fn(), jest.fn()]
  const view = await render(<WorkspaceTabs value="a" tabs={tabs} onChange={select} testID="workspace-tabs" />)
  expect(view.getByRole('tab', { name: 'Connection' })).toHaveProp('tabIndex', 0)
  expect(view.getByRole('tab', { name: 'Requests' })).toHaveProp('tabIndex', -1)
  expect(view.getByRole('tab', { name: 'Disabled' })).toBeDisabled()
  const key = (key: string) => fireEvent(view.getByTestId('workspace-tabs'), 'keyDown', {
    key, preventDefault: jest.fn(), currentTarget: { querySelectorAll: () => focus.map(fn => ({ focus: fn })) },
  })
  await key('ArrowRight')
  expect(select).toHaveBeenLastCalledWith('c')
  expect(focus[2]).toHaveBeenCalledTimes(1)
  await key('ArrowLeft')
  expect(select).toHaveBeenLastCalledWith('c')
  await key('Home')
  expect(select).toHaveBeenLastCalledWith('a')
  await key('End')
  expect(select).toHaveBeenLastCalledWith('c')
  await fireEvent.press(view.getByRole('tab', { name: 'Disabled' }))
  expect(select).toHaveBeenCalledTimes(4)
})

it('keeps radio semantics and blocks both keyboard and touch changes while saving', async () => {
  const change = jest.fn()
  const view = await render(<WorkspaceTabs role="radio" accessibilityLabel="Fallback consent" value="a" tabs={tabs}
    onChange={change} testID="consent" disabled />)
  expect(view.getByTestId('consent')).toHaveProp('accessibilityRole', 'radiogroup')
  expect(view.getByTestId('consent')).toHaveProp('accessibilityLabel', 'Fallback consent')
  expect(view.getByRole('radio', { name: 'Connection' })).toBeChecked()
  await fireEvent.press(view.getByRole('radio', { name: 'Requests' }))
  await fireEvent(view.getByTestId('consent'), 'keyDown', { key: 'ArrowRight' })
  expect(change).not.toHaveBeenCalled()
})

it.each(['android', 'ios'])('keeps enabled %s radio choices available to native focus and touch', async platform => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform })
  const change = jest.fn()
  const view = await render(<WorkspaceTabs role="radio" value="a" tabs={tabs} onChange={change} testID="native-choice" />)
  const unselected = view.getByRole('radio', { name: 'Requests' })
  expect(unselected).not.toHaveProp('tabIndex')
  expect(unselected).toHaveProp('focusable', true)
  expect(unselected).not.toBeDisabled()
  await fireEvent.press(unselected)
  expect(change).toHaveBeenCalledWith('c')
  await fireEvent.press(view.getByRole('radio', { name: 'Disabled' }))
  expect(change).toHaveBeenCalledTimes(1)
})

it('retains an edited native input and its owner through all theme families and modes', async () => {
  const mounted = jest.fn()
  const unmounted = jest.fn()
  function Draft() {
    const [text, setText] = useState('')
    useEffect(() => { mounted(); return unmounted }, [])
    return <TextInput testID="retained-draft" value={text} onChangeText={setText} />
  }
  const tree = () => <ThemeDetailFrame kind="providers" title="An intentionally long detail title" onBack={jest.fn()} backLabel="Back"><Draft /></ThemeDetailFrame>
  const view = await render(tree())
  await fireEvent.changeText(view.getByTestId('retained-draft'), 'unsaved work')
  for (const family of CANONICAL_THEME_IDS) for (const mode of ['light', 'dark'] as const) {
    mockFamily = family; mockMode = mode
    await view.rerender(tree())
    expect(view.getByTestId('retained-draft').props.value).toBe('unsaved work')
    expect(view.getByRole('button', { name: 'Back' })).toBeTruthy()
  }
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(unmounted).not.toHaveBeenCalled()
})

it('uses opacity-only selection feedback when reduced motion is enabled', async () => {
  const view = await render(<WorkspaceTabs value="a" tabs={tabs} onChange={jest.fn()} testID="reduced-tabs" />)
  expect(view.getByTestId('reduced-tabs-a-selection', { includeHiddenElements: true }).props.animate).toEqual({ opacity: 1 })
  await view.rerender(<WorkspaceTabs value="c" tabs={tabs} onChange={jest.fn()} testID="reduced-tabs" />)
  expect(view.getByTestId('reduced-tabs-c-selection', { includeHiddenElements: true }).props.animate).toEqual({ opacity: 1 })
})
