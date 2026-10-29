import { createRef } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Platform, StyleSheet, TextInput as NativeInput } from 'react-native'
import { AppFontContext, Text, TextInput } from './AppText'
import { fontFamilyForTheme } from '@/theme/font'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'

it('uses the bundled font for labels and editable text while preserving explicit code fonts and input refs', async () => {
  const ref = createRef<NativeInput>()
  const view = await render(<><Text testID="label">你好 Hello</Text><Text testID="code" style={{ fontFamily: 'monospace' }}>code()</Text><TextInput ref={ref} testID="input" /></>)
  expect(StyleSheet.flatten(view.getByTestId('label').props.style).fontFamily).toBe('NotoSansSC')
  expect(StyleSheet.flatten(view.getByTestId('input').props.style).fontFamily).toBe('NotoSansSC')
  expect(StyleSheet.flatten(view.getByTestId('code').props.style).fontFamily).toBe('monospace')
  expect(ref.current).toBeTruthy()
  expect(TextInput.State).toBe(NativeInput.State)
})

it('changes the actual family without remounting an input or replacing explicit code fonts', async () => {
  const ref = createRef<NativeInput>()
  const tree = (family: string) => <AppFontContext.Provider value={family}>
    <Text testID="label">你好 日本語 Hello</Text>
    <Text testID="code" style={{ fontFamily: 'monospace' }}>code()</Text>
    <TextInput ref={ref} testID="input" value="kept draft" />
  </AppFontContext.Provider>
  const screen = await render(tree(fontFamilyForTheme('minimal')))
  const input = ref.current
  for (const [theme, face] of [['monet', 'NotoSerifSC'], ['animal-island-ui', 'LXGWWenKai'], ['material', 'NotoSansSC']] as const) {
    await screen.rerender(tree(fontFamilyForTheme(theme)))
    expect(screen.getByTestId('label')).toHaveStyle({ fontFamily: face })
    expect(screen.getByTestId('input')).toHaveStyle({ fontFamily: face })
    expect(screen.getByTestId('input').props.value).toBe('kept draft')
    expect(ref.current).toBe(input)
    expect(screen.getByTestId('code')).toHaveStyle({ fontFamily: 'monospace' })
  }
})

async function onPlatform(os: 'web' | 'ios', operation: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(Platform, 'OS')!
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os })
  try { await operation() }
  finally { Object.defineProperty(Platform, 'OS', descriptor) }
}

it('uses font-relative web line boxes for labels and editable text', async () => {
  await onPlatform('web', async () => {
    const screen = await render(<>
      <Text testID="label" style={{ fontSize: 12, lineHeight: 16 }}>Completed 7 steps</Text>
      <TextInput testID="input" style={{ fontSize: 12, lineHeight: 16 }} value="Kept editable draft" />
    </>)
    expect(StyleSheet.flatten(screen.getByTestId('label').props.style).lineHeight).toBe('1.5')
    expect(StyleSheet.flatten(screen.getByTestId('input').props.style).lineHeight).toBe('1.5')
    expect(screen.getByTestId('input').props.value).toBe('Kept editable draft')
  })
})

it('derives web line boxes from the final merged typography without replacing code fonts', async () => {
  await onPlatform('web', async () => {
    const screen = await render(<Text testID="code" style={[
      { fontSize: 12, lineHeight: 16 },
      { fontSize: 20, lineHeight: 36, fontFamily: 'monospace', color: '#123456' },
    ]}>code()</Text>)
    const style = StyleSheet.flatten(screen.getByTestId('code').props.style)
    expect(style.lineHeight).toBe('1.8')
    expect(style.fontFamily).toBe('monospace')
    expect(style.color).toBe('#123456')
  })
})

it('keeps native numeric line heights and font-scaling props unchanged', async () => {
  await onPlatform('ios', async () => {
    const screen = await render(<>
      <Text testID="native-label" allowFontScaling={false} style={{ fontSize: 12, lineHeight: 16 }}>Native label</Text>
      <TextInput testID="native-input" allowFontScaling style={{ fontSize: 12, lineHeight: 16 }} value="Native draft" />
    </>)
    expect(StyleSheet.flatten(screen.getByTestId('native-label').props.style).lineHeight).toBe(16)
    expect(StyleSheet.flatten(screen.getByTestId('native-input').props.style).lineHeight).toBe(16)
    expect(screen.getByTestId('native-label').props.allowFontScaling).toBe(false)
    expect(screen.getByTestId('native-input').props.allowFontScaling).toBe(true)
  })
})

it('updates web typography without replacing the input, draft or imperative ref', async () => {
  await onPlatform('web', async () => {
    const ref = createRef<NativeInput>()
    const tree = (fontSize: number) => <TextInput
      ref={ref} testID="web-input" value={'Unchanged two-line\ndraft'}
      style={{ fontSize, lineHeight: fontSize + 4 }}
    />
    const screen = await render(tree(12))
    const input = ref.current
    await screen.rerender(tree(20))
    expect(ref.current).toBe(input)
    expect(screen.getByTestId('web-input').props.value).toBe('Unchanged two-line\ndraft')
  })
})

it('projects input focus as a scoped update blocker while preserving focus callbacks and unmount cleanup', async () => {
  const onFocus = jest.fn()
  const onBlur = jest.fn()
  const screen = await render(<TextInput testID="focused-input" onFocus={onFocus} onBlur={onBlur} />)
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
  await fireEvent(screen.getByTestId('focused-input'), 'focus', { nativeEvent: {} })
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  expect(onFocus).toHaveBeenCalledTimes(1)
  await fireEvent(screen.getByTestId('focused-input'), 'blur', { nativeEvent: {} })
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
  expect(onBlur).toHaveBeenCalledTimes(1)
  await fireEvent(screen.getByTestId('focused-input'), 'focus', { nativeEvent: {} })
  await screen.unmount()
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
})
