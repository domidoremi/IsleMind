import { act, fireEvent, render } from '@testing-library/react-native'
import type { MessageCitation } from '@/types/contextContracts'
import { SourceCitationNavigation } from './SourceCitationNavigation'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))

const citations: MessageCitation[] = [
  { id: 'a', type: 'knowledge', title: 'First source' },
  { id: 'b', type: 'memory', title: 'Second source' },
]

it('marks the explicit source as selected without changing it on repeated activation', async () => {
  const onSelect = jest.fn()
  const screen = await render(<SourceCitationNavigation citations={citations} selectedId="b" wide={false} onSelect={onSelect} />)
  await fireEvent.press(screen.getByTestId('source-citation-picker'))
  expect(screen.getByTestId('source-citation-1').props.accessibilityState.selected).toBe(true)
  expect(screen.getByTestId('source-citation-0').props.accessibilityState.selected).toBe(false)
  await fireEvent.press(screen.getByTestId('source-citation-1'))
  expect(onSelect).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByTestId('source-citation-picker'))
  await fireEvent.press(screen.getByTestId('source-citation-0'))
  expect(onSelect).toHaveBeenCalledWith('a')
})

it('does not select a missing or ambiguous identity and disables duplicate source choices', async () => {
  const onSelect = jest.fn()
  const rows = [...citations, { ...citations[0], title: 'Duplicate identity' }]
  const screen = await render(<SourceCitationNavigation citations={rows} selectedId="a" wide={false} onSelect={onSelect} />)
  await fireEvent.press(screen.getByTestId('source-citation-picker'))
  expect(screen.getByTestId('source-citation-0')).toBeDisabled()
  expect(screen.getByTestId('source-citation-2')).toBeDisabled()
  expect(screen.getByTestId('source-citation-0').props.accessibilityState.selected).toBe(false)
  await fireEvent.press(screen.getByTestId('source-citation-0'))
  expect(onSelect).not.toHaveBeenCalled()
  await screen.rerender(<SourceCitationNavigation citations={rows} selectedId="missing" wide={false} onSelect={onSelect} />)
  await fireEvent.press(screen.getByTestId('source-citation-picker'))
  expect(screen.getByTestId('source-citation-1').props.accessibilityState.selected).toBe(false)
})

it('keeps the same picker list and choices when the compact controls become a persistent rail', async () => {
  const screen = await render(<SourceCitationNavigation citations={citations} selectedId="b" wide={false} onSelect={jest.fn()} />)
  const nav = screen.getByTestId('source-citation-navigation')
  const list = screen.getByTestId('source-citation-list', { includeHiddenElements: true })
  expect(list).toHaveStyle({ display: 'none' })
  await fireEvent.press(screen.getByTestId('source-citation-picker'))
  const choice = screen.getByTestId('source-citation-1')
  await screen.rerender(<SourceCitationNavigation citations={citations} selectedId="b" wide onSelect={jest.fn()} />)
  expect(screen.getByTestId('source-citation-navigation')).toBe(nav)
  expect(screen.getByTestId('source-citation-list')).toBe(list)
  expect(list).toHaveStyle({ display: 'flex' })
  expect(screen.getByTestId('source-citation-1')).toBe(choice)
  expect(choice).toHaveStyle({ width: '100%', minHeight: 56 })
  await fireEvent(choice, 'focus')
  expect(choice).toHaveStyle({ borderColor: require('@/theme/colors').getColors('light', 'minimal').ui.semantic.control.focus })
})

it('opens the picker without changing the source and advances only to a unique next identity', async () => {
  const onSelect = jest.fn()
  const rows = [citations[0], { ...citations[1], id: 'duplicate' }, { ...citations[1], id: 'duplicate' }, citations[1]]
  const screen = await render(<SourceCitationNavigation citations={rows} selectedId="a" wide={false} onSelect={onSelect} />)
  expect(screen.getByTestId('source-citation-previous')).toBeDisabled()
  await fireEvent.press(screen.getByTestId('source-citation-picker'))
  expect(onSelect).not.toHaveBeenCalled()
  expect(screen.getByTestId('source-citation-1')).toBeDisabled()
  await fireEvent.press(screen.getByTestId('source-citation-next'))
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith('b')
  expect(screen.getByTestId('source-citation-picker').props.accessibilityState.expanded).toBe(false)
})

it('cancels a pending selection-reveal frame when the navigation is removed', async () => {
  const cancel = jest.spyOn(globalThis, 'cancelAnimationFrame')
  const screen = await render(<SourceCitationNavigation citations={citations} selectedId="b" wide onSelect={jest.fn()} />)
  await act(() => screen.unmount())
  expect(cancel).toHaveBeenCalled()
  cancel.mockRestore()
})
