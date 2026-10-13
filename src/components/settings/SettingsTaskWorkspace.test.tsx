import { fireEvent, render } from '@testing-library/react-native'
import { useState } from 'react'
import { TextInput } from 'react-native'
import { SettingsTaskWorkspace } from './SettingsTaskWorkspace'

let mockTarget: string | undefined
let mockMayLeave = true
let mockTheme = 'minimal'
let mockMode = 'light'
const mockLeave = jest.fn(async (action: () => void) => { if (mockMayLeave) action() })
jest.mock('./SettingsSection', () => ({ ...jest.requireActual('./SettingsSection'), useSettingsTarget: () => mockTarget }))
jest.mock('./SettingsEditBoundary', () => ({ useSettingsLeave: () => mockLeave }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ canonicalThemeId: mockTheme, colors: require('@/theme/colors').getColors(mockMode, mockTheme) }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const tasks = [
  { id: 'identity', title: 'Name', description: 'Change the assistant name', icon: 'bot' as const, content: <TextInput accessibilityLabel="Name editor" /> },
  { id: 'generation', title: 'Replies', description: 'Adjust output limits', icon: 'settings-sliders' as const, targets: ['generation-tokens'], content: <TextInput accessibilityLabel="Token editor" /> },
]
beforeEach(() => { mockTarget = undefined; mockMayLeave = true; mockLeave.mockClear() })

it('opens one task without mounting unrelated editors and guards return navigation', async () => {
  const screen = await render(<SettingsTaskWorkspace tasks={tasks} />)
  expect(screen.queryByLabelText('Name editor')).toBeNull()
  expect(screen.queryByLabelText('Token editor')).toBeNull()
  await fireEvent.press(screen.getByTestId('settings-task-identity'))
  expect(screen.getByLabelText('Name editor')).toBeTruthy()
  expect(screen.queryByLabelText('Token editor')).toBeNull()
  mockMayLeave = false
  await fireEvent.press(screen.getByLabelText('common.back'))
  expect(screen.getByLabelText('Name editor')).toBeTruthy()
  mockMayLeave = true
  await fireEvent.press(screen.getByLabelText('common.back'))
  expect(screen.queryByLabelText('Name editor')).toBeNull()
  expect(mockLeave).toHaveBeenCalledTimes(2)
})

it('opens a field search result directly in its task, not behind another disclosure', async () => {
  mockTarget = 'generation-tokens'
  const screen = await render(<SettingsTaskWorkspace tasks={tasks} />)
  expect(screen.getByLabelText('Token editor')).toBeTruthy()
  expect(screen.queryByLabelText('Name editor')).toBeNull()
})

it('opens an initial search target in a controlled workspace too', async () => {
  mockTarget = 'generation-tokens'
  function Controlled() {
    const [value, setValue] = useState<string | null>(null)
    return <SettingsTaskWorkspace tasks={tasks} value={value} onTaskChange={id => setValue(id ?? null)} />
  }
  const screen = await render(<Controlled />)
  expect(screen.getByLabelText('Token editor')).toBeTruthy()
  await fireEvent.press(screen.getByLabelText('common.back'))
  expect(screen.queryByLabelText('Token editor')).toBeNull()
})


it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'].flatMap(family => ['light', 'dark'].map(mode => [family, mode])))('keeps simple fields visible and complex fields guarded in %s / %s', async (family, mode) => {
  mockTheme = family
  mockMode = mode
  const screen = await render(<SettingsTaskWorkspace inline alwaysVisible={['identity']} tasks={tasks} />)
  expect(screen.getByLabelText('Name editor')).toBeTruthy()
  expect(screen.queryByLabelText('Token editor')).toBeNull()
  await fireEvent.press(screen.getByTestId('settings-task-generation'))
  expect(screen.getByLabelText('Name editor')).toBeTruthy()
  expect(screen.getByLabelText('Token editor')).toBeTruthy()
  expect(screen.getByTestId('settings-task-generation').props.accessibilityState.expanded).toBe(true)
  mockMayLeave = false
  await fireEvent.press(screen.getByTestId('settings-task-generation'))
  expect(screen.getByLabelText('Token editor')).toBeTruthy()
  mockMayLeave = true
  await fireEvent.press(screen.getByTestId('settings-task-generation'))
  expect(screen.queryByLabelText('Token editor')).toBeNull()
})

it('locates a nested field in the inline layout without hiding everyday fields', async () => {
  mockTarget = 'generation-tokens'
  const screen = await render(<SettingsTaskWorkspace inline alwaysVisible={['identity']} tasks={tasks} />)
  expect(screen.getByLabelText('Name editor')).toBeTruthy()
  expect(screen.getByLabelText('Token editor')).toBeTruthy()
})
