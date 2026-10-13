import { fireEvent, render } from '@testing-library/react-native'
import { SettingsReferenceField } from './SettingsReferenceField'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/isle', () => {
  const { View, Pressable, Text, TextInput } = require('react-native')
  return { IslePressable: Pressable, IsleInput: TextInput,
    IsleButton: ({ label, ...props }: any) => <Pressable accessibilityRole="button" {...props}><Text>{label}</Text></Pressable>,
    IsleSelect: ({ options, onChange, disabled }: any) => <View>{options.map((option: any) => <Pressable key={option.value} accessibilityLabel={option.label} disabled={disabled} onPress={() => onChange(option.value)}><Text>{option.label}</Text></Pressable>)}</View>,
  }
})
it('retains unknown imported IDs, deduplicates additions and supports explicit removal', async () => {
  const onChange = jest.fn()
  const screen = await render(<SettingsReferenceField label="Tools" value="legacy, known" options={[{ value: 'known', label: 'Known' }, { value: 'new', label: 'New' }, { value: 'new', label: 'New' }]} onChange={onChange} />)
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByText('legacy · agents.unresolved')).toBeTruthy()
  expect(screen.getAllByLabelText('New')).toHaveLength(1)
  await fireEvent.press(screen.getByLabelText('New'))
  expect(onChange).toHaveBeenLastCalledWith('legacy\nknown\nnew')
  await fireEvent.press(screen.getByLabelText('settingsReferences.remove legacy · agents.unresolved'))
  expect(onChange).toHaveBeenLastCalledWith('known')
})
it('keeps manual compatibility input hidden until requested and makes busy references read-only', async () => {
  const onChange = jest.fn()
  const renderField = (disabled: boolean) => <SettingsReferenceField label="Model" value="legacy-model" multiple={false} options={[{ value: 'next', label: 'Next' }]} onChange={onChange} disabled={disabled} />
  const screen = await render(renderField(false))
  expect(screen.queryByLabelText('Model')).toBeNull()
  await fireEvent.press(screen.getByLabelText('settingsReferences.manual Model'))
  expect(screen.getByLabelText('Model').props.value).toBe('legacy-model')
  await fireEvent.press(screen.getByLabelText('Next'))
  expect(onChange).toHaveBeenLastCalledWith('next')
  await screen.rerender(renderField(true))
  expect(screen.getByLabelText('Model').props.editable).toBe(false)
  onChange.mockClear()
  await fireEvent.press(screen.getByLabelText('Next'))
  expect(onChange).not.toHaveBeenCalled()
})
