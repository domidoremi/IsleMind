import { createRef } from 'react'
import { render } from '@testing-library/react-native'
import { StyleSheet, TextInput as NativeInput } from 'react-native'
import { AppFontContext, Text, TextInput } from './AppText'
import { fontFamilyForTheme } from '@/theme/font'

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
