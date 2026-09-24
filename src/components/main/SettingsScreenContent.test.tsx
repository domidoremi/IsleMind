import { render } from '@testing-library/react-native'
import { SettingsScreenContent } from './SettingsScreenContent'
import { SettingsNavigationContent } from '@/components/settings/SettingsNavigationContent'
jest.mock('@/components/settings/SettingsNavigationContent', () => ({ SettingsNavigationContent: jest.fn(() => null) }))
it('composes the task-oriented settings home without mounting a system editor', async () => {
  await render(<SettingsScreenContent shellNavigation />)
  expect(jest.mocked(SettingsNavigationContent).mock.calls[0][0]).toEqual({ shellNavigation: true, onHome: undefined })
})
