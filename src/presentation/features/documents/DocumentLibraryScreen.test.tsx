import { act, fireEvent, render, within } from '@testing-library/react-native'
import { router } from 'expo-router'
import type { DocumentRepository, DocumentSummary } from '@/modules/documents'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { FlatList } from 'react-native'
import DocumentLibraryScreen from './DocumentLibraryScreen'

let mockFamily: CanonicalThemeId = 'minimal'
let mockFocused = true
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), canGoBack: () => false, replace: jest.fn() },
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: require('@/theme/colors').getColors('light', mockFamily), canonicalThemeId: mockFamily,
}) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/hooks/useThemeMotion', () => ({ useThemeMotion: () => ({ transition: {} }) }))
jest.mock('@/components/ui/FeedbackGlyph', () => ({ FeedbackGlyph: require('react-native').View }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({
  ThemeDetailFrame: ({ actions, children }: { actions: React.ReactNode; children: React.ReactNode }) => <>{actions}{children}</>,
}))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  return {
    IslePressable: Pressable, IsleMotionFrame: View, IsleSearchField: TextInput,
    IsleButton: ({ label, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable>,
  }
})

function repository(list: jest.Mock) { return { list } as unknown as DocumentRepository }
function summaries(): DocumentSummary[] {
  return [{ id: 'first', title: 'First idea', updatedAt: 10 }, { id: 'second', title: 'Second idea', updatedAt: 20 }] as DocumentSummary[]
}
beforeEach(() => { jest.clearAllMocks(); mockFamily = 'minimal'; mockFocused = true })

it('explicitly centers the empty-catalog action across theme button implementations', async () => {
  const view = await render(<DocumentLibraryScreen repository={repository(jest.fn().mockResolvedValue([]))} />)
  expect(view.getByTestId('document-library-create')).toHaveStyle({ alignSelf: 'center' })
})

it('uses a busy list placeholder on the first read instead of claiming the library is empty', async () => {
  let finish!: (rows: DocumentSummary[]) => void
  const list = jest.fn(() => new Promise<DocumentSummary[]>(resolve => { finish = resolve }))
  const view = await render(<DocumentLibraryScreen repository={repository(list)} />)
  expect(view.getByTestId('document-library-loading').props.accessibilityState.busy).toBe(true)
  expect(view.queryByText('documents.emptyTitle')).toBeNull()
  await act(() => finish([]))
  expect(view.queryByTestId('document-library-loading')).toBeNull()
  expect(view.getByText('documents.emptyTitle')).toBeTruthy()
})

it('retains the loaded catalog and search during refresh, and distinguishes a refresh failure from an initial read failure', async () => {
  let reject!: (error: Error) => void
  const list = jest.fn().mockResolvedValueOnce(summaries())
    .mockImplementationOnce(() => new Promise<DocumentSummary[]>((_resolve, fail) => { reject = fail }))
    .mockResolvedValueOnce(summaries())
  const repo = repository(list)
  const page = () => <DocumentLibraryScreen repository={repo} />
  const view = await render(page())
  const search = view.getByLabelText('documents.search')
  await fireEvent.changeText(search, 'second')
  const row = view.getByTestId('document-row-second')
  mockFocused = false; await view.rerender(page())
  mockFocused = true; await view.rerender(page())
  expect(view.getByTestId('document-row-second')).toBe(row)
  expect(view.getByTestId('document-library-status').props.phase).toBe('pending')
  expect(view.queryByTestId('document-library-loading')).toBeNull()
  expect(view.queryByText('documents.emptyTitle')).toBeNull()
  await act(() => reject(new Error('Read failed')))
  expect(view.getByRole('alert')).toHaveTextContent('documents.refreshFailed')
  expect(view.getByTestId('document-row-second')).toBe(row)
  expect(view.getByLabelText('documents.search')).toBe(search)
  expect(search.props.value).toBe('second')
  await fireEvent.press(view.getByRole('button', { name: 'common.retry' }))
  expect(view.queryByRole('alert')).toBeNull()
  expect(view.getByTestId('document-row-second')).toBe(row)
  expect(list).toHaveBeenCalledTimes(3)
})

it('restores the catalog and query after route replacement, then retains the new view through failure and retry', async () => {
  let reject!: (error: Error) => void
  const list = jest.fn().mockResolvedValueOnce(summaries())
    .mockImplementationOnce(() => new Promise<DocumentSummary[]>((_resolve, fail) => { reject = fail }))
    .mockResolvedValueOnce(summaries())
  const repo = repository(list)
  const original = await render(<DocumentLibraryScreen repository={repo} />)
  await fireEvent.changeText(original.getByLabelText('documents.search'), 'second')
  await original.unmount()
  const returned = await render(<DocumentLibraryScreen repository={repo} />)
  const search = returned.getByLabelText('documents.search')
  const row = returned.getByTestId('document-row-second')
  expect(search.props.value).toBe('second')
  expect(returned.queryByTestId('document-row-first')).toBeNull()
  expect(returned.queryByTestId('document-library-loading')).toBeNull()
  expect(returned.getByTestId('document-library-status').props.phase).toBe('pending')
  await act(() => reject(new Error('Read failed')))
  expect(returned.getByRole('alert')).toHaveTextContent('documents.refreshFailed')
  expect(returned.getByTestId('document-row-second')).toBe(row)
  expect(returned.getByLabelText('documents.search')).toBe(search)
  await fireEvent.press(returned.getByRole('button', { name: 'common.retry' }))
  expect(returned.queryByRole('alert')).toBeNull()
  expect(returned.getByTestId('document-row-second')).toBe(row)
  expect(returned.getByLabelText('documents.search').props.value).toBe('second')
  expect(list).toHaveBeenCalledTimes(3)
})

it('isolates cached catalog state by repository when the active repository changes', async () => {
  let finish!: (rows: DocumentSummary[]) => void
  const first = repository(jest.fn().mockResolvedValue(summaries()))
  const second = repository(jest.fn(() => new Promise<DocumentSummary[]>(resolve => { finish = resolve })))
  const view = await render(<DocumentLibraryScreen repository={first} />)
  await fireEvent.changeText(view.getByLabelText('documents.search'), 'second')
  await view.rerender(<DocumentLibraryScreen repository={second} />)
  expect(view.getByLabelText('documents.search').props.value).toBe('')
  expect(view.queryByTestId('document-library-catalog')).toBeNull()
  expect(view.getByTestId('document-library-loading')).toBeTruthy()
  await act(() => finish([{ ...summaries()[0], title: 'Another library' }]))
  expect(view.getByRole('button', { name: 'Another library' })).toBeTruthy()
  await view.rerender(<DocumentLibraryScreen repository={first} />)
  expect(view.getByLabelText('documents.search').props.value).toBe('second')
  expect(view.getByTestId('document-row-second')).toBeTruthy()
  expect(view.queryByRole('button', { name: 'Another library' })).toBeNull()
})

it('does not publish an abandoned read into the catalog restored by a replacement route', async () => {
  let finish!: (rows: DocumentSummary[]) => void
  const latest = [{ ...summaries()[0], title: 'Current catalog' }]
  const list = jest.fn().mockImplementationOnce(() => new Promise<DocumentSummary[]>(resolve => { finish = resolve }))
    .mockResolvedValue(latest)
  const repo = repository(list)
  const abandoned = await render(<DocumentLibraryScreen repository={repo} />)
  const signal = list.mock.calls[0][0].signal as AbortSignal
  await abandoned.unmount()
  expect(signal.aborted).toBe(true)
  const current = await render(<DocumentLibraryScreen repository={repo} />)
  await act(() => finish(summaries()))
  expect(current.getByRole('button', { name: 'Current catalog' })).toBeTruthy()
  expect(current.queryByRole('button', { name: 'Second idea' })).toBeNull()
  await current.unmount()
  const restored = await render(<DocumentLibraryScreen repository={repo} />)
  expect(restored.getByRole('button', { name: 'Current catalog' })).toBeTruthy()
  expect(restored.queryByRole('button', { name: 'Second idea' })).toBeNull()
})

it('ignores a cancelled refresh even when a newer focused read has already completed', async () => {
  let finish!: (rows: DocumentSummary[]) => void
  const latest = [{ ...summaries()[0], title: 'Latest catalog' }]
  const list = jest.fn().mockResolvedValueOnce(summaries())
    .mockImplementationOnce(() => new Promise<DocumentSummary[]>(resolve => { finish = resolve }))
    .mockResolvedValueOnce(latest)
  const repo = repository(list)
  const page = () => <DocumentLibraryScreen repository={repo} />
  const view = await render(page())
  mockFocused = false; await view.rerender(page())
  mockFocused = true; await view.rerender(page())
  const signal = list.mock.calls[1][0].signal as AbortSignal
  mockFocused = false; await view.rerender(page())
  expect(signal.aborted).toBe(true)
  mockFocused = true; await view.rerender(page())
  await act(() => finish(summaries()))
  expect(view.getByRole('button', { name: 'Latest catalog' })).toBeTruthy()
  expect(view.queryByRole('button', { name: 'Second idea' })).toBeNull()
})

it('gives an empty local library a clear creation action, without creating or sending anything automatically', async () => {
  const list = jest.fn().mockResolvedValue([])
  const view = await render(<DocumentLibraryScreen repository={repository(list)} />)
  expect(view.getByText('documents.emptyTitle')).toBeTruthy()
  expect(view.queryByText('documents.empty')).toBeNull()
  expect(view.queryByText('documents.libraryNotice')).toBeNull()
  await fireEvent.press(view.getByTestId('document-library-storage-toggle'))
  expect(view.getByText('documents.libraryNotice')).toBeTruthy()
  expect(view.getByTestId('document-library-storage-toggle').props.accessibilityState.expanded).toBe(true)
  expect(router.push).not.toHaveBeenCalled()
  await fireEvent.press(view.getByTestId('document-library-create'))
  expect(router.push).toHaveBeenCalledWith('/documents/edit')
})

it('preserves the search input and catalog across every family and clears only the query', async () => {
  const list = jest.fn().mockResolvedValue(summaries())
  const repo = repository(list)
  const view = await render(<DocumentLibraryScreen repository={repo} />)
  const search = view.getByLabelText('documents.search')
  await fireEvent.changeText(search, 'second')
  for (const family of CANONICAL_THEME_IDS) {
    mockFamily = family
    await view.rerender(<DocumentLibraryScreen repository={repo} />)
    expect(view.getByLabelText('documents.search')).toBe(search)
    expect(search.props.value).toBe('second')
    expect(view.getByRole('button', { name: 'Second idea' })).toBeTruthy()
    expect(view.queryByRole('button', { name: 'First idea' })).toBeNull()
  }
  await fireEvent.changeText(search, 'not present')
  expect(view.getByText('documents.noMatches')).toBeTruthy()
  await fireEvent.press(view.getByTestId('document-library-clear'))
  expect(search.props.value).toBe('')
  expect(view.getByRole('button', { name: 'First idea' })).toBeTruthy()
  expect(list).toHaveBeenCalledTimes(1)
  expect(router.push).not.toHaveBeenCalled()
})

it('keeps read errors visible and retries the repository instead of substituting an empty library', async () => {
  const list = jest.fn().mockRejectedValueOnce(new Error('Read failed')).mockResolvedValueOnce(summaries())
  const view = await render(<DocumentLibraryScreen repository={repository(list)} />)
  expect(view.getByRole('alert')).toHaveTextContent('documents.loadFailed')
  expect(view.queryByText('documents.emptyTitle')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'common.retry' }))
  expect(view.queryByRole('alert')).toBeNull()
  expect(view.getByRole('button', { name: 'First idea' })).toBeTruthy()
  expect(list).toHaveBeenCalledTimes(2)
})

it('aborts the owned read on exit and ignores a late result', async () => {
  let finish!: (rows: DocumentSummary[]) => void
  const list = jest.fn((_options: { signal: AbortSignal }) => new Promise<DocumentSummary[]>(resolve => { finish = resolve }))
  const view = await render(<DocumentLibraryScreen repository={repository(list)} />)
  const signal = list.mock.calls[0][0].signal as AbortSignal
  await view.unmount()
  expect(signal.aborted).toBe(true)
  await act(() => finish(summaries()))
  expect(router.push).not.toHaveBeenCalled()
})

it('sorts the existing catalog without re-reading it and retains the chosen sort when returning', async () => {
  const list = jest.fn().mockResolvedValue(summaries())
  const repo = repository(list)
  const view = await render(<DocumentLibraryScreen repository={repo} />)
  expect(view.getAllByTestId(/^document-row-/).map(row => row.props.testID)).toEqual(['document-row-second', 'document-row-first'])
  await fireEvent.press(view.getByTestId('document-sort-title'))
  expect(view.getAllByTestId(/^document-row-/).map(row => row.props.testID)).toEqual(['document-row-first', 'document-row-second'])
  await fireEvent.press(view.getByTestId('document-row-second'))
  expect(list).toHaveBeenCalledTimes(1)
  await view.unmount()
  const returned = await render(<DocumentLibraryScreen repository={repo} />)
  expect(returned.getByTestId('document-sort-title').props.accessibilityState.checked).toBe(true)
  expect(returned.getByTestId('document-row-second').props.accessibilityState.selected).toBe(true)
  expect(router.push).toHaveBeenCalledWith({ pathname: '/documents/edit', params: { id: 'second' } })
})

it('pins catalog commands outside the virtualized reading list and adds summary-only group headings', async () => {
  const list = jest.fn().mockResolvedValue(summaries())
  const repo = { list, get: jest.fn(), save: jest.fn(), create: jest.fn() } as unknown as DocumentRepository
  const view = await render(<DocumentLibraryScreen repository={repo} />)
  const commands = view.getByTestId('document-library-commands')
  const search = view.getByLabelText('documents.search')
  const reading = within(view.getByTestId('document-library-list'))
  expect(reading.queryByLabelText('documents.search')).toBeNull()
  expect(within(commands).getByLabelText('documents.search')).toBe(search)
  expect(reading.getAllByTestId(/^document-catalog-group:/)).toHaveLength(1)
  expect(reading.getAllByTestId(/^document-row-/)).toHaveLength(2)
  await fireEvent.scroll(view.getByTestId('document-library-list'), { nativeEvent: { contentOffset: { x: 0, y: 400 } } })
  await fireEvent.press(view.getByTestId('document-sort-title'))
  expect(view.getByTestId('document-library-commands')).toBe(commands)
  expect(view.getByLabelText('documents.search')).toBe(search)
  expect(repo.get).not.toHaveBeenCalled()
  expect(repo.save).not.toHaveBeenCalled()
  expect(repo.create).not.toHaveBeenCalled()
  expect(list).toHaveBeenCalledTimes(1)
})

it.each(['viewport-first', 'content-first'] as const)('restores cached scroll with %s measurement and resets it on a new query', async (order) => {
  const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => undefined)
  try {
    const repo = repository(jest.fn().mockResolvedValue(summaries()))
    const view = await render(<DocumentLibraryScreen repository={repo} />)
    const list = view.getByTestId('document-library-list')
    await fireEvent(list, 'layout', { nativeEvent: { layout: { width: 390, height: 100, x: 0, y: 0 } } })
    await fireEvent(list, 'contentSizeChange', 390, 600)
    await fireEvent.scroll(list, { nativeEvent: { contentOffset: { x: 0, y: 240 } } })
    await view.unmount()
    scroll.mockClear()
    const returned = await render(<DocumentLibraryScreen repository={repo} />)
    const restored = returned.getByTestId('document-library-list')
    if (order === 'content-first') {
      await fireEvent(restored, 'contentSizeChange', 390, 600)
      expect(scroll).not.toHaveBeenCalled()
      await fireEvent(restored, 'layout', { nativeEvent: { layout: { width: 390, height: 100, x: 0, y: 0 } } })
    } else {
      await fireEvent(restored, 'layout', { nativeEvent: { layout: { width: 390, height: 100, x: 0, y: 0 } } })
      await fireEvent(restored, 'contentSizeChange', 390, 600)
    }
    expect(scroll).toHaveBeenLastCalledWith({ offset: 240, animated: false })
    await fireEvent.changeText(returned.getByLabelText('documents.search'), 'second')
    expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: false })
  } finally { scroll.mockRestore() }
})
