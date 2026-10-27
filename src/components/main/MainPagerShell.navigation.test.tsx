import { Suspense } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { MainPagerShell, type MainPagerPage } from './MainPagerShell'

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
    const { Pressable, Text } = require('react-native')
    return <Pressable testID="history-new-chat" onPress={onHome}><Text>New chat</Text></Pressable>
  },
}))
jest.mock('./SettingsScreenContent', () => ({
  SettingsScreenContent: ({ onHome }: { onHome: () => void }) => {
    const { Pressable, Text } = require('react-native')
    return <Pressable testID="settings-home" onPress={onHome}><Text>Home</Text></Pressable>
  },
}))
jest.mock('./HomeScreenContent', () => ({
  HomeScreenContent: ({ active, onHistory, onSettings }: {
    active: boolean; onHistory: () => void; onSettings: () => void
  }) => {
    const React = require('react')
    const { Pressable, Text, View } = require('react-native')
    const [instance] = React.useState(() => ++mockHomeSequence)
    React.useEffect(() => {
      mockHomeEvents.push(`mount:${instance}`)
      return () => mockHomeEvents.push(`unmount:${instance}`)
    }, [instance])
    return (
      <View testID={`home-workspace-${instance}`}>
        <Text>{active ? 'Active composer' : 'Retained composer'}</Text>
        <Pressable testID="home-history" onPress={onHistory}><Text>History</Text></Pressable>
        <Pressable testID="home-settings" onPress={onSettings}><Text>Settings</Text></Pressable>
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
