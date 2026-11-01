import { fireEvent, render } from '@testing-library/react-native'
import SourceRoute from '../../../app/source'
import UsageRoute from '../../../app/settings/usage'
import { IsleDialogContext } from '@/components/ui/isle/isleDialogContext'
import type { IsleDialogApi } from '@/components/ui/isle/isleDialogTypes'

let mockParams: Record<string, string> = {}
let mockLocalDialog: IsleDialogApi
const globalApi: IsleDialogApi = {
  toast: jest.fn(), notice: jest.fn(), confirm: jest.fn().mockResolvedValue(false),
  banner: jest.fn().mockReturnValue('banner'), dismissBanner: jest.fn(),
  hasPendingDialogs: jest.fn().mockReturnValue(false), subscribeDialogs: jest.fn().mockReturnValue(() => undefined),
}
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors('light', 'minimal')
  return { colors, design: colors.design, canonicalThemeId: 'minimal', mode: 'light' }
} }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/settings/SettingsEditBoundary', () => ({
  SettingsEditBoundary: ({ children }: any) => children,
  useSettingsLeave: () => (action: () => void) => action(),
}))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({ ThemeDetailFrame: ({ children }: any) => children }))
jest.mock('@/utils/lazyLoad', () => ({
  createLazyComponent: () => {
    const { Pressable: MockPressable, Text: MockText, TextInput: MockInput } = require('react-native')
    const React = require('react')
    const { useIsleDialog } = require('@/components/ui/isle/Dialog')
    return function MockLazyProducer() {
      mockLocalDialog = useIsleDialog()
      const [draft, setDraft] = React.useState('initial')
      return <>
        <MockInput testID="draft" value={draft} onChangeText={setDraft} />
        <MockPressable testID="report" onPress={() => mockLocalDialog.toast({ title: 'Fixture failure', tone: 'danger' })}><MockText>Report</MockText></MockPressable>
      </>
    }
  },
}))
beforeEach(() => { jest.clearAllMocks(); mockParams = {} })

function tree(Route: typeof SourceRoute | typeof UsageRoute) {
  return <IsleDialogContext.Provider value={globalApi}><Route /></IsleDialogContext.Provider>
}

it.each([
  ['source', SourceRoute],
  ['usage', UsageRoute],
] as const)('scopes %s routine feedback outside its lazy business producer without replacing safety APIs', async (name, Route) => {
  const screen = await render(tree(Route))
  expect(mockLocalDialog.toast).not.toBe(globalApi.toast)
  expect(mockLocalDialog.confirm).toBe(globalApi.confirm)
  expect(mockLocalDialog.notice).toBe(globalApi.notice)
  await fireEvent.press(screen.getByTestId('report'))
  expect(globalApi.toast).not.toHaveBeenCalled()
  if (name === 'usage') expect(screen.getByText('Fixture failure')).toBeTruthy()
})

it('changes source feedback ownership without remounting its business content', async () => {
  const screen = await render(tree(SourceRoute))
  await fireEvent.changeText(screen.getByTestId('draft'), 'retained source state')
  const oldToast = mockLocalDialog.toast
  mockParams = { citationId: 'different-source' }
  await screen.rerender(tree(SourceRoute))
  expect(mockLocalDialog.toast).not.toBe(oldToast)
  expect(screen.getByTestId('draft').props.value).toBe('retained source state')
})
