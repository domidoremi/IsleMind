import { createRef } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Appearance, FlatList as NativeFlatList, Platform, ScrollView as NativeScrollView, Text } from 'react-native'
import { FlatList, ScrollView } from './AppScrollView'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
function appearance(family: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, family)
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design, canonicalThemeId: family, mode,
    isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
}
afterEach(() => jest.restoreAllMocks())
const cases = (['ios', 'android', 'web'] as const).flatMap(platform => CANONICAL_THEME_IDS.flatMap(family =>
  (['light', 'dark'] as const).map(mode => ({ platform, family, mode }))))

it.each(cases)('preserves $platform/$family/$mode scroll hosts, refs and callbacks while changing app mode', async ({ platform, family, mode }) => {
  jest.replaceProperty(Platform, 'OS', platform)
  appearance(family, mode)
  const setNativeScheme = jest.spyOn(Appearance, 'setColorScheme')
  const scrollRef = createRef<NativeScrollView>(), listRef = createRef<NativeFlatList<{ id: string }>>()
  const onScroll = jest.fn(), onLayout = jest.fn(), onContentSizeChange = jest.fn()
  const data = [{ id: 'keep-a' }, { id: 'keep-b' }]
  const tree = () => <>
    <ScrollView ref={scrollRef} testID="themed-scroll" horizontal nestedScrollEnabled scrollEnabled={false}
      showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      contentOffset={{ x: 30, y: 80 }} contentContainerStyle={{ padding: 12 }} style={{ flex: 1 }}
      onScroll={onScroll} onLayout={onLayout} onContentSizeChange={onContentSizeChange} scrollEventThrottle={64}>
      <Text>保留 Draft 下書き</Text>
    </ScrollView>
    <FlatList ref={listRef} testID="themed-list" data={data} keyExtractor={item => item.id}
      renderItem={({ item }) => <Text>{item.id}</Text>} keyboardShouldPersistTaps="always" initialNumToRender={2}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }} />
  </>
  const screen = await render(tree())
  const scrollHost = screen.getByTestId('themed-scroll'), listHost = screen.getByTestId('themed-list')
  const scrollInstance = scrollRef.current, listInstance = listRef.current
  expect(scrollInstance).not.toBeNull(); expect(listInstance).not.toBeNull()
  expect(typeof scrollInstance?.scrollTo).toBe('function')
  expect(typeof listInstance?.scrollToOffset).toBe('function')
  for (const nextMode of [mode, mode === 'dark' ? 'light' : 'dark', mode] as const) {
    appearance(family, nextMode)
    await screen.rerender(tree())
    expect(screen.getByTestId('themed-scroll')).toBe(scrollHost)
    expect(screen.getByTestId('themed-list')).toBe(listHost)
    expect(scrollRef.current).toBe(scrollInstance); expect(listRef.current).toBe(listInstance)
    const indicatorStyle = nextMode === 'dark' ? 'white' : 'black'
    expect(scrollHost.props).toMatchObject({ indicatorStyle, horizontal: true, nestedScrollEnabled: true, scrollEnabled: false,
      showsHorizontalScrollIndicator: false, showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: 'handled',
      contentOffset: { x: 30, y: 80 }, scrollEventThrottle: 64 })
    expect(listHost.props).toMatchObject({ indicatorStyle, keyboardShouldPersistTaps: 'always',
      maintainVisibleContentPosition: { minIndexForVisible: 0 } })
    expect(scrollHost).toHaveStyle({ flex: 1 })
    expect(scrollHost.props.contentContainerStyle).toMatchObject({ padding: 12 })
    expect(screen.getByText('保留 Draft 下書き')).toBeTruthy()
  }
  const event = { nativeEvent: { contentOffset: { x: 30, y: 80 }, contentSize: { width: 900, height: 1600 },
    layoutMeasurement: { width: 320, height: 600 } } }
  expect(onScroll).not.toHaveBeenCalled()
  await fireEvent.scroll(scrollHost, event)
  await fireEvent(scrollHost, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 600 } } })
  await fireEvent(scrollHost, 'contentSizeChange', 900, 1600)
  expect(onScroll).toHaveBeenCalledTimes(1); expect(onScroll).toHaveBeenCalledWith(expect.objectContaining({ nativeEvent: expect.objectContaining(event.nativeEvent) }))
  expect(onLayout).toHaveBeenCalledTimes(1); expect(onContentSizeChange).toHaveBeenCalledWith(900, 1600)
  expect(setNativeScheme).not.toHaveBeenCalled()
  await screen.unmount()
  expect(scrollRef.current).toBeNull(); expect(listRef.current).toBeNull()
})

it('resolves an explicit default to app mode and preserves a deliberate contrasting indicator override', async () => {
  appearance('minimal', 'dark')
  const screen = await render(<>
    <ScrollView testID="default-scroll" indicatorStyle="default" />
    <ScrollView testID="override-scroll" indicatorStyle="black" />
    <FlatList testID="default-list" indicatorStyle="default" data={[]} renderItem={() => null} />
    <FlatList testID="override-list" indicatorStyle="black" data={[]} renderItem={() => null} />
  </>)
  expect(screen.getByTestId('default-scroll').props.indicatorStyle).toBe('white')
  expect(screen.getByTestId('default-list').props.indicatorStyle).toBe('white')
  expect(screen.getByTestId('override-scroll').props.indicatorStyle).toBe('black')
  expect(screen.getByTestId('override-list').props.indicatorStyle).toBe('black')
})
