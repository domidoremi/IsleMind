import { act, fireEvent, render } from '@testing-library/react-native'
import { TextInput } from '@/components/ui/AppText'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { IsleSearchField } from './SearchField'

type MockInput = { id: string; live: boolean; isFocused: () => boolean; blur: jest.Mock }
let mockFocusOwner: MockInput | undefined
const mockInputs = new Map<string, MockInput>()

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useThemeMotion', () => ({ useThemeMotion: () => ({ transition: { duration: 0 } }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1, regular: 1 } }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('./Pressable', () => ({ IslePressable: require('react-native').Pressable }))
jest.mock('./Tooltip', () => ({ IsleTooltip: ({ children }: { children: unknown }) => children }))
jest.mock('@/components/ui/AppText', () => {
  const React = require('react')
  const Native = require('react-native')
  return {
    TextInput: React.forwardRef((props: any, forwardedRef: any) => {
      const internal = React.useRef(null)
      if (!internal.current) {
        const host: MockInput = {
          id: props.testID ?? props.accessibilityLabel,
          live: true,
          isFocused: () => mockFocusOwner === internal.current,
          blur: jest.fn(() => {
            if (!host.live) throw Error('The native child reference was already disposed')
            if (mockFocusOwner === host) mockFocusOwner = undefined
          }),
        }
        internal.current = host
        mockInputs.set(host.id, host)
      }
      React.useImperativeHandle(forwardedRef, () => internal.current, [])
      React.useLayoutEffect(() => () => {
        internal.current.live = false
        internal.current = null
      }, [])
      return React.createElement(Native.TextInput, {
        ...props,
        onFocus: (event: unknown) => { mockFocusOwner = internal.current; props.onFocus?.(event) },
      })
    }),
  }
})
jest.mock('animal-island-ui-rn', () => {
  const React = require('react')
  const { TextInput: Field } = require('@/components/ui/AppText')
  return {
    Input: ({ inputRef, inputProps, disabled, ...props }: any) =>
      React.createElement(Field, { ...props, ...inputProps, editable: !disabled, ref: inputRef }),
  }
})

function theme(id: CanonicalThemeId) {
  const colors = getColors('dark', id)
  jest.mocked(useAppTheme).mockReturnValue({ colors, canonicalThemeId: id, design: colors.design } as ReturnType<typeof useAppTheme>)
}

beforeEach(() => {
  mockFocusOwner = undefined
  mockInputs.clear()
  theme('animal-island-ui')
})

it.each(['animal-island-ui', 'minimal', 'monet', 'material', 'liquid-glass'] as const)(
  '%s retires its focused native child before that child is disposed',
  async id => {
    theme(id)
    const screen = await render(<IsleSearchField testID="owned" accessibilityLabel="owned" value="retained search" clearAccessibilityLabel="Clear" />)
    await fireEvent(screen.getByLabelText('owned'), 'focus', { nativeEvent: {} })
    const host = mockInputs.get('owned')!
    expect(mockFocusOwner).toBe(host)
    await act(async () => { await screen.unmount() })
    expect(host.blur).toHaveBeenCalledTimes(1)
    expect(mockFocusOwner).toBeUndefined()
    expect(host.live).toBe(false)
  },
)

it('unmounting an unfocused field preserves the other field that owns focus', async () => {
  const first = await render(<IsleSearchField testID="first" accessibilityLabel="first" value="first" clearAccessibilityLabel="Clear" />)
  const other = await render(<IsleSearchField testID="other" accessibilityLabel="other" value="other" clearAccessibilityLabel="Clear" />)
  await fireEvent(other.getByLabelText('other'), 'focus', { nativeEvent: {} })
  const owner = mockInputs.get('other')!
  await act(async () => { await first.unmount() })
  expect(mockInputs.get('first')!.blur).not.toHaveBeenCalled()
  expect(mockFocusOwner).toBe(owner)
  expect(owner.live).toBe(true)
  await other.unmount()
})

it('continues delivering the same host to changed callback refs without retiring live focus', async () => {
  const first = jest.fn(), next = jest.fn()
  const screen = await render(<IsleSearchField testID="owned" accessibilityLabel="owned" value="keep" inputRef={first} clearAccessibilityLabel="Clear" />)
  await fireEvent(screen.getByLabelText('owned'), 'focus', { nativeEvent: {} })
  const host = mockInputs.get('owned')!
  expect(first).toHaveBeenLastCalledWith(host)
  await screen.rerender(<IsleSearchField testID="owned" accessibilityLabel="owned" value="keep" inputRef={next} clearAccessibilityLabel="Clear" />)
  expect(first).toHaveBeenLastCalledWith(null)
  expect(next).toHaveBeenLastCalledWith(host)
  expect(host.blur).not.toHaveBeenCalled()
  expect(mockFocusOwner).toBe(host)
  expect(screen.getByLabelText('owned').props.value).toBe('keep')
  await screen.unmount()
  expect(next).toHaveBeenLastCalledWith(null)
})

it('keeps the editable host, external object ref and focus during ordinary theme restyling', async () => {
  theme('minimal')
  const inputRef = { current: null as TextInput | null }
  const screen = await render(<IsleSearchField testID="owned" accessibilityLabel="owned" value="keep" inputRef={inputRef} clearAccessibilityLabel="Clear" />)
  await fireEvent(screen.getByLabelText('owned'), 'focus', { nativeEvent: {} })
  const host = mockInputs.get('owned')!
  for (const id of ['monet', 'material', 'liquid-glass'] as const) {
    theme(id)
    await screen.rerender(<IsleSearchField testID="owned" accessibilityLabel="owned" value="keep" inputRef={inputRef} clearAccessibilityLabel="Clear" />)
    expect(inputRef.current).toBe(host)
    expect(mockFocusOwner).toBe(host)
    expect(host.blur).not.toHaveBeenCalled()
    expect(screen.getByLabelText('owned').props.value).toBe('keep')
  }
  await screen.unmount()
  expect(inputRef.current).toBeNull()
})

it('retires the old native input when the theme replaces the editable host', async () => {
  const screen = await render(<IsleSearchField testID="owned" accessibilityLabel="owned" value="keep" clearAccessibilityLabel="Clear" />)
  await fireEvent(screen.getByLabelText('owned'), 'focus', { nativeEvent: {} })
  const old = mockInputs.get('owned')!
  theme('minimal')
  await screen.rerender(<IsleSearchField testID="owned" accessibilityLabel="owned" value="keep" clearAccessibilityLabel="Clear" />)
  expect(mockInputs.get('owned')).not.toBe(old)
  expect(old.blur).toHaveBeenCalledTimes(1)
  expect(mockFocusOwner).toBeUndefined()
  expect(screen.getByLabelText('owned').props.value).toBe('keep')
  await screen.unmount()
})
