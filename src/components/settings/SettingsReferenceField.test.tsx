import { act, fireEvent, render } from '@testing-library/react-native'
import { SettingsReferenceField } from './SettingsReferenceField'
let mockSelectChange: (value: string) => void
let mockRemovePress: () => void
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/isle', () => {
  const { View, Pressable: MockPressable, Text, TextInput } = require('react-native')
  return { IslePressable: MockPressable, IsleInput: TextInput,
    IsleButton: ({ label, ...props }: any) => {
      mockRemovePress = props.onPress
      return <MockPressable accessibilityRole="button" {...props}><Text>{label}</Text></MockPressable>
    },
    IsleSelect: ({ options, onChange, disabled }: any) => {
      mockSelectChange = onChange
      return <View>{options.map((option: any) => <MockPressable key={option.value} accessibilityLabel={option.label} disabled={disabled} onPress={() => onChange(option.value)}><Text>{option.label}</Text></MockPressable>)}</View>
    },
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

it('retains selected IDs and manual editing but blocks stale catalog additions until the catalog is ready', async () => {
  const onChange = jest.fn()
  const field = (catalogReady: boolean) => <SettingsReferenceField label="Tools" value="legacy" catalogReady={catalogReady}
    options={[{ value: 'stale', label: 'Previous catalog tool' }]} onChange={onChange} />
  const screen = await render(field(false))
  expect(screen.getByText('legacy')).toBeTruthy()
  expect(screen.queryByText('legacy · agents.unresolved')).toBeNull()
  await fireEvent.press(screen.getByLabelText('Previous catalog tool'))
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByLabelText('settingsReferences.manual Tools'))
  await fireEvent.changeText(screen.getByLabelText('Tools'), 'legacy, explicit-manual')
  expect(onChange).toHaveBeenLastCalledWith('legacy, explicit-manual')
  onChange.mockClear()
  await screen.rerender(field(true))
  await fireEvent.press(screen.getByLabelText('Previous catalog tool'))
  expect(onChange).toHaveBeenLastCalledWith('legacy\nstale')
})

it.each(['selection', 'removal', 'manual'])('ignores a captured %s callback after the parent draft changes', async kind => {
  const onChange = jest.fn()
  const tree = (value: string) => <SettingsReferenceField label="Tools" value={value}
    options={[{ value: 'candidate', label: 'Candidate' }]} onChange={onChange} />
  const screen = await render(tree('original'))
  await fireEvent.press(screen.getByLabelText('settingsReferences.manual Tools'))
  const oldSelect = mockSelectChange
  const oldRemove = mockRemovePress
  const oldManual = screen.getByLabelText('Tools').props.onChangeText
  await screen.rerender(tree('new selection'))
  await act(() => {
    if (kind === 'selection') oldSelect('candidate')
    else if (kind === 'removal') oldRemove()
    else oldManual('old manual text')
  })
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Tools').props.value).toBe('new selection')
  await act(() => mockSelectChange('candidate'))
  expect(onChange).toHaveBeenLastCalledWith('new selection\ncandidate')
})

it('ignores selection through a retained callback after the field is unmounted', async () => {
  const onChange = jest.fn()
  const screen = await render(<SettingsReferenceField label="Tools" value=""
    options={[{ value: 'candidate', label: 'Candidate' }]} onChange={onChange} />)
  const oldSelect = mockSelectChange
  await screen.unmount()
  await act(() => oldSelect('candidate'))
  expect(onChange).not.toHaveBeenCalled()
})
