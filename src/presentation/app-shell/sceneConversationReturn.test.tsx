import { Text } from 'react-native'
import { Stack } from 'expo-router'
import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library'
import ScenePlansRoute from '../../../app/settings/scenes'
import ConversationDeepLinkScreen from '../../../app/chat/[id]'
import { resolveConversationReturnAction, resolveRouteReturnIntent } from './routeReturnPolicy'

const mockSceneMounted = jest.fn()
const mockSceneUnmounted = jest.fn()

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/bootstrap/scenePlanRuntime', () => ({ scenePlanRuntime: {} }))
jest.mock('@/components/settings/SettingsPageShell', () => ({ SettingsPageShell: ({ children }: any) => children }))
jest.mock('@/utils/lazyLoad', () => ({ createLazyComponent: (load: () => Promise<any>) => {
  const React = jest.requireActual<typeof import('react')>('react')
  const Component = React.lazy(load)
  return (props: any) => <React.Suspense fallback={null}><Component {...props} /></React.Suspense>
} }))
jest.mock('@/presentation/features/settings/ScenePlansScreen', () => ({ ScenePlansScreen: (props: any) => {
  const React = jest.requireActual<typeof import('react')>('react')
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  const [text, setText] = React.useState('Saved scene')
  React.useEffect(() => { mockSceneMounted(); return () => { mockSceneUnmounted() } }, [])
  return <>
    <Native.Text testID="selected-scene">{props.planId ?? 'Scene list'}</Native.Text>
    <Native.TextInput testID="retained-scene-input" value={text} onChangeText={setText} />
    <Native.Pressable testID="open-applied-conversation" onPress={() => props.onOpenConversation('owned-chat')}>
      <Native.Text>Open applied conversation</Native.Text>
    </Native.Pressable>
  </>
} }))
jest.mock('@/store/chatStore', () => ({ useChatStore: (selector: (state: any) => unknown) => selector({
  conversations: [{ id: 'owned-chat', title: 'Applied scene', providerId: 'provider', model: 'model',
    systemPrompt: '', temperature: 0.6, maxTokens: 1000, messages: [], createdAt: 1, updatedAt: 1 }],
  select: () => undefined, ensureLoaded: async () => true,
}) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: { ui: { family: 'minimal' } } }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({ ThemeDetailFrame: ({ children }: any) => children }))
jest.mock('@/components/ui/isle', () => ({ IsleButton: () => null, IsleEmptyState: () => null }))
jest.mock('@/components/chat/ChatWorkspace', () => ({ ChatWorkspace: ({ conversation, onHistory }: any) => {
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  return <>
    <Native.Text testID="opened-conversation">{conversation.id}</Native.Text>
    <Native.Pressable testID="return-from-conversation" onPress={onHistory}><Native.Text>Back</Native.Text></Native.Pressable>
  </>
} }))

const routes = {
  _layout: () => <Stack screenOptions={{ animation: 'none' }} />,
  index: () => <Text>Home</Text>,
  conversations: () => <Text>History</Text>,
  'settings/scenes': ScenePlansRoute,
  'chat/[id]': ConversationDeepLinkScreen,
}

beforeEach(() => { mockSceneMounted.mockClear(); mockSceneUnmounted.mockClear() })
afterEach(() => { jest.useRealTimers() })

it('returns to the same scene and retains its local state after opening the applied conversation', async () => {
  const view = await renderRouter(routes, { initialUrl: '/settings/scenes?planId=owned-plan' })
  await waitFor(() => expect(view.getByTestId('selected-scene')).toHaveTextContent('owned-plan'))
  await fireEvent.changeText(view.getByTestId('retained-scene-input'), 'Local scene review')
  await fireEvent.press(view.getByTestId('open-applied-conversation'))
  await waitFor(() => expect(view.getByTestId('opened-conversation')).toHaveTextContent('owned-chat'))
  await fireEvent.press(view.getByTestId('return-from-conversation'))
  await waitFor(() => expect(view.getByTestId('selected-scene')).toHaveTextContent('owned-plan'))
  expect(view.getByTestId('retained-scene-input')).toHaveProp('value', 'Local scene review')
  expect(mockSceneMounted).toHaveBeenCalledTimes(1)
  expect(mockSceneUnmounted).not.toHaveBeenCalled()
})

it('returns a direct conversation link with a scene origin to the scene list', async () => {
  const view = await renderRouter(routes, { initialUrl: '/chat/owned-chat?returnTo=scenes' })
  await waitFor(() => expect(view.getByTestId('opened-conversation')).toHaveTextContent('owned-chat'))
  await fireEvent.press(view.getByTestId('return-from-conversation'))
  await waitFor(() => expect(view.getByTestId('selected-scene')).toHaveTextContent('Scene list'))
  expect(view.queryByText('History')).toBeNull()
})

it('recognizes a scene origin from route parameters and retains the safe fallback', () => {
  expect(resolveRouteReturnIntent(['scenes', '/untrusted'])).toBe('scenes')
  expect(resolveConversationReturnAction('scenes', true)).toEqual({ kind: 'back' })
  expect(resolveConversationReturnAction('scenes', false)).toEqual({ kind: 'replace', pathname: '/settings/scenes' })
  expect(resolveConversationReturnAction('/settings/scenes', true)).toEqual({ kind: 'replace', pathname: '/conversations' })
})
