import { useEffect, useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, TextInput } from 'react-native'

import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { resolveBackgroundEnvironment } from '@/theme/backgroundEnvironment'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { resolveBackgroundCanvas } from './Background'
import { IsleScreen } from './Screen'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'reduced' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('expo-blur', () => ({ BlurView: require('react-native').View, BlurTargetView: require('react-native').View }))
jest.mock('animal-island-ui-rn', () => ({
  ...jest.requireActual('animal-island-ui-rn'),
  Background: require('react-native').View,
}))
jest.mock('./FluidBackdrop', () => ({
  FluidBackdrop: (props: object) => require('react').createElement(require('react-native').View, props),
}))

function setTheme(family: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, family)
  jest.mocked(useAppTheme).mockReturnValue({
    colors, canonicalThemeId: family, isDark: mode === 'dark', isLiquidGlass: family === 'liquid-glass',
    backgroundEnvironment: resolveBackgroundEnvironment({ family, mode, variation: 'fixed' }),
  } as ReturnType<typeof useAppTheme>)
  return colors
}

it.each(['light', 'dark'] as const)('retains the %s canvas, draft and selection when decoration mounts or disappears', async (mode) => {
  const mounted = jest.fn()
  const unmounted = jest.fn()
  const changed = jest.fn()
  function RetainedDraft() {
    const [draft, setDraft] = useState('Original local draft')
    const [selection, setSelection] = useState({ start: 0, end: 0 })
    useEffect(() => {
      mounted()
      return () => { unmounted() }
    }, [])
    return <TextInput testID="retained-draft" value={draft} selection={selection}
      onChangeText={(text) => { changed(text); setDraft(text) }}
      onSelectionChange={(event) => setSelection(event.nativeEvent.selection)} />
  }
  setTheme('material', mode)
  const content = () => <IsleScreen><RetainedDraft /></IsleScreen>
  const screen = await render(content())
  await fireEvent.changeText(screen.getByTestId('retained-draft'), 'An explicitly edited local draft')
  await fireEvent(screen.getByTestId('retained-draft'), 'selectionChange', {
    nativeEvent: { selection: { start: 4, end: 11 } },
  })
  for (const family of ['monet', 'material', 'liquid-glass', 'minimal', 'animal-island-ui', 'material'] satisfies CanonicalThemeId[]) {
    const colors = setTheme(family, mode)
    await screen.rerender(content())
    const artwork = screen.container.queryAll((node) => String(node.props.testID ?? '').startsWith('theme-background-'))
    if (family === 'minimal' || family === 'material') {
      expect(artwork).toHaveLength(0)
    } else {
      expect(artwork.length).toBeGreaterThan(0)
    }
    const canvases = screen.container.queryAll((node) => node.type === 'View')
      .map((node) => StyleSheet.flatten(node.props.style))
    expect(canvases).toContainEqual(expect.objectContaining({
      flex: 1, backgroundColor: resolveBackgroundCanvas(colors),
    }))
    expect(screen.getByTestId('retained-draft').props.value).toBe('An explicitly edited local draft')
    expect(screen.getByTestId('retained-draft').props.selection).toEqual({ start: 4, end: 11 })
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
    expect(changed).toHaveBeenCalledTimes(1)
  }
  await screen.unmount()
  expect(unmounted).toHaveBeenCalledTimes(1)
})
