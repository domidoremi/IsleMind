import { Suspense } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { MainPagerShell, type MainPagerPage } from './MainPagerShell'
import { redirectSystemPath } from '../../../app/+native-intent'
import { getMainPagerNavigationIntent } from '@/presentation/app-shell/mainPagerNavigationIntent'

const mockRoute = { pathname: '/conversations' }
const mockReplace = jest.fn()
const mockHomeEvents: string[] = []
let mockHomeSequence = 0

jest.mock('expo-router', () => ({
  usePathname: () => mockRoute.pathname,
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: { background: { canvas: '#ffffff' }, ui: { experience: { background: 'plain' } } } }),
}))
jest.mock('@/components/ui/isle', () => ({
  IsleScreen: ({ children }: { children: React.ReactNode }) => {
    const { View } = require('react-native')
    return <View>{children}</View>
  },
  IsleMotionFrame: ({ children, active }: { children: React.ReactNode; active: boolean }) => {
    const { View } = require('react-native')
    return <View testID={active ? 'active-page' : 'retained-page'}>{children}</View>
  },
}))
jest.mock('@/utils/lazyLoad', () => ({
  createLazyComponent: (loader: () => Promise<unknown>) => require('react').lazy(loader),
}))
jest.mock('./ConversationsScreenContent', () => ({
  ConversationsScreenContent: ({ onHome }: { onHome: () => void }) => {
    const { Pressable: MockPressable, Text } = require('react-native')
    return <MockPressable testID="history-new-chat" onPress={onHome}><Text>New chat</Text></MockPressable>
  },
}))
jest.mock('./SettingsScreenContent', () => ({
  SettingsScreenContent: ({ onHome }: { onHome: () => void }) => {
    const { Pressable: MockPressable, Text } = require('react-native')
    return <MockPressable testID="settings-home" onPress={onHome}><Text>Home</Text></MockPressable>
  },
}))
jest.mock('./HomeScreenContent', () => ({
  HomeScreenContent: ({ active, onHistory, onSettings }: {
    active: boolean; onHistory: () => void; onSettings: () => void
  }) => {
    const React = require('react')
    const { Pressable: MockPressable, Text, TextInput, View } = require('react-native')
    const [instance] = React.useState(() => ++mockHomeSequence)
    const [draft, setDraft] = React.useState('')
    React.useEffect(() => {
      mockHomeEvents.push(`mount:${instance}`)
      return () => mockHomeEvents.push(`unmount:${instance}`)
    }, [instance])
    return (
      <View testID={`home-workspace-${instance}`}>
        <Text>{active ? 'Active composer' : 'Retained composer'}</Text>
        <TextInput testID="home-draft" value={draft} onChangeText={setDraft} />
        <MockPressable testID="home-history" onPress={onHistory}><Text>History</Text></MockPressable>
        <MockPressable testID="home-settings" onPress={onSettings}><Text>Settings</Text></MockPressable>
      </View>
    )
  },
}))

const shell = (initialPage: MainPagerPage) => (
  <Suspense fallback={null}><MainPagerShell initialPage={initialPage} /></Suspense>
)

beforeEach(() => {
  mockRoute.pathname = '/conversations'
  mockReplace.mockReset()
  mockHomeEvents.length = 0
  mockHomeSequence = 0
})

it.each([
  ['/conversations', 'history', 'history-new-chat'],
  ['/settings', 'settings', 'settings-home'],
] as const)('does not mount a disposable composer before replacing %s with Home', async (pathname, page, trigger) => {
  mockRoute.pathname = pathname
  const view = await render(shell(page))
  expect(mockHomeEvents).toEqual([])

  await fireEvent.press(view.getByTestId(trigger))

  expect(mockReplace.mock.calls).toEqual([['/']])
  expect(mockHomeEvents).toEqual([])
  expect(view.queryByText('Retained composer')).toBeNull()
  expect(view.queryByText('Active composer')).toBeNull()
})

it.each([
  ['/conversations', 'history', 'history-new-chat'],
  ['/settings', 'settings', 'settings-home'],
] as const)('mounts one composer only after the %s handoff reaches the root route', async (pathname, page, trigger) => {
  mockRoute.pathname = pathname
  const outgoing = await render(shell(page))

  await fireEvent.press(outgoing.getByTestId(trigger))
  expect(outgoing.getByTestId(trigger)).toBeTruthy()
  expect(mockHomeEvents).toEqual([])
  await outgoing.unmount()

  mockRoute.pathname = '/'
  const root = await render(shell('home'))
  expect(root.getByText('Active composer')).toBeTruthy()
  expect(mockHomeEvents).toEqual(['mount:1'])
  expect(mockReplace.mock.calls).toEqual([['/']])

  await root.rerender(shell('home'))
  expect(mockHomeEvents).toEqual(['mount:1'])
})

it.each([
  ['home-history', 'history-new-chat'],
  ['home-settings', 'settings-home'],
])('keeps the existing root composer when returning through %s', async (outgoing, returning) => {
  mockRoute.pathname = '/'
  const view = await render(shell('home'))
  expect(mockHomeEvents).toEqual(['mount:1'])

  await fireEvent.press(view.getByTestId(outgoing))
  await view.findByTestId(returning)
  await fireEvent.press(view.getByTestId(returning))

  expect(view.getByText('Active composer')).toBeTruthy()
  expect(mockHomeEvents).toEqual(['mount:1'])
  expect(mockReplace).not.toHaveBeenCalled()
})

it('does not expose an outgoing Home workspace on repeated fast History New chat clicks', async () => {
  const view = await render(shell('history'))
  const trigger = view.getByTestId('history-new-chat')
  await fireEvent.press(trigger)
  await fireEvent.press(trigger)
  await view.rerender(shell('history'))

  expect(mockReplace.mock.calls).toEqual([['/'], ['/']])
  expect(mockHomeEvents).toEqual([])
  expect(view.queryByText('Retained composer')).toBeNull()

  await view.unmount()
  mockRoute.pathname = '/'
  const root = await render(shell('home'))
  expect(root.getByText('Active composer')).toBeTruthy()
  expect(mockHomeEvents).toEqual(['mount:1'])
})

it.each(['home-settings', 'home-history'])('honors repeated warm Home intents from %s while retaining the draft and composer', async outgoing => {
  mockRoute.pathname = '/'
  const view = await render(shell('home'))
  await fireEvent.changeText(view.getByTestId('home-draft'), 'Keep this unsent draft 日本語')
  for (let cycle = 0; cycle < 2; cycle++) {
    await fireEvent.press(view.getByTestId(outgoing))
    await view.findByText('Retained composer')
    await act(() => {
      expect(redirectSystemPath({ path: 'islemind://home', initial: false })).toBe('/')
    })
    expect(view.getByText('Active composer')).toBeTruthy()
    expect(view.getByTestId('home-draft').props.value).toBe('Keep this unsent draft 日本語')
  }
  expect(mockHomeEvents).toEqual(['mount:1'])
  expect(mockReplace).not.toHaveBeenCalled()
})

it.each([['/settings', 'settings'], ['/conversations', 'history']] as const)(
  'leaves the outgoing %s shell without mounting a disposable composer for a Home intent', async (pathname, page) => {
    mockRoute.pathname = pathname
    const outgoing = await render(shell(page))
    await act(() => { redirectSystemPath({ path: 'islemind://home', initial: false }) })
    mockRoute.pathname = '/'
    await outgoing.rerender(shell(page))
    expect(mockHomeEvents).toEqual([])
    await outgoing.unmount()
    const root = await render(shell('home'))
    expect(root.getByText('Active composer')).toBeTruthy()
    expect(mockHomeEvents).toEqual(['mount:1'])
  },
)

it('does not treat cold startup or unrelated child links as a fresh root-page intent', async () => {
  mockRoute.pathname = '/'
  const view = await render(shell('home'))
  await fireEvent.press(view.getByTestId('home-settings'))
  await view.findByText('Retained composer')
  const previous = getMainPagerNavigationIntent()
  await act(() => {
    expect(redirectSystemPath({ path: 'islemind://home', initial: true })).toBe('/')
    expect(redirectSystemPath({ path: 'islemind://settings/providers?setup=add', initial: false })).toBe('/settings/providers?setup=add')
  })
  expect(getMainPagerNavigationIntent()).toBe(previous)
  expect(view.getByText('Retained composer')).toBeTruthy()
})
