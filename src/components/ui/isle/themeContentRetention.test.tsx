import { useEffect, useState } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { Pressable as MockPressable, Text, TextInput } from 'react-native'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IslePanel } from './Panel'
import { ThemeExpressionSurface } from './ThemeExpressionSurface'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/components/ui/isle', () => ({
  IsleScreen: require('react-native').View,
  IslePressable: require('react-native').Pressable,
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 2 } }))

const mockTheme = jest.mocked(useAppTheme)
function appearance(family: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, family)
  mockTheme.mockReturnValue({ colors, design: colors.design, canonicalThemeId: family, mode, isLiquidGlass: family === 'liquid-glass' } as ReturnType<typeof useAppTheme>)
  return colors
}

it.each(['panel', 'composer', 'message', 'detail'] as const)(
  '%s preserves a draft and an in-flight result through every family and mode',
  async kind => {
    const unmount = jest.fn()
    let complete: (value: string) => void = () => undefined
    const operation = new Promise<string>(resolve => { complete = resolve })
    function Editor() {
      const [draft, setDraft] = useState('initial')
      const [result, setResult] = useState('idle')
      useEffect(() => () => { unmount() }, [])
      return <>
        <TextInput testID="draft" value={draft} onChangeText={setDraft} />
        <MockPressable testID="run" onPress={() => { setResult('pending'); void operation.then(setResult) }}><Text>{result}</Text></MockPressable>
      </>
    }
    const tree = (family: CanonicalThemeId, mode: 'light' | 'dark') => {
      const colors = appearance(family, mode)
      const child = <Editor />
      return kind === 'panel' ? <IslePanel>{child}</IslePanel>
        : kind === 'detail' ? <ThemeDetailFrame kind="documents" title="Document" backLabel="Back" onBack={() => undefined}>{child}</ThemeDetailFrame>
          : <ThemeExpressionSurface family={family} colors={colors} kind={kind} isUser={kind === 'message'}>{child}</ThemeExpressionSurface>
    }
    const view = await render(tree('minimal', 'light'))
    await fireEvent.changeText(view.getByTestId('draft'), 'keep this draft')
    await fireEvent.press(view.getByTestId('run'))
    for (const family of CANONICAL_THEME_IDS) {
      for (const mode of ['dark', 'light'] as const) {
        await view.rerender(tree(family, mode))
        expect(view.getByTestId('draft').props.value).toBe('keep this draft')
        expect(view.getByText('pending')).toBeTruthy()
        expect(unmount).not.toHaveBeenCalled()
      }
    }
    await act(async () => { complete('done'); await operation })
    await waitFor(() => expect(view.getByText('done')).toBeTruthy())
    await view.unmount()
    expect(unmount).toHaveBeenCalledTimes(1)
  },
)
