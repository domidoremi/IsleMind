import { act, renderHook } from '@testing-library/react-native'
import type { DocumentRepository } from '@/modules/documents'
import { useDocumentLibraryViewState } from './useDocumentLibraryViewState'

it('restores search, sorting, the opened row and scroll when a route remounts', async () => {
  const repository = {} as DocumentRepository
  const screen = await renderHook(() => useDocumentLibraryViewState(repository))
  await act(() => {
    screen.result.current.setQuery('Report')
    screen.result.current.setSort('title')
    screen.result.current.setOpenedId('report')
    screen.result.current.setScrollOffset(400)
  })
  await screen.unmount()
  const returned = await renderHook(() => useDocumentLibraryViewState(repository))
  expect(returned.result.current).toMatchObject({ query: 'Report', sort: 'title', openedId: 'report' })
  expect(returned.result.current.getScrollOffset()).toBe(400)
  await act(() => returned.result.current.setQuery('Another'))
  expect(returned.result.current.getScrollOffset()).toBe(0)
  await act(() => returned.result.current.setScrollOffset(200))
  await act(() => returned.result.current.setSort('updated'))
  expect(returned.result.current.getScrollOffset()).toBe(0)
})

it('isolates view state by repository and does not publish every scroll into React', async () => {
  const repository = {} as DocumentRepository
  const screen = await renderHook(() => useDocumentLibraryViewState(repository))
  const current = screen.result.current
  await act(() => current.setScrollOffset(240))
  expect(screen.result.current).toBe(current)
  const another = await renderHook(() => useDocumentLibraryViewState({} as DocumentRepository))
  expect(another.result.current.getScrollOffset()).toBe(0)
  await act(() => current.setScrollOffset(NaN))
  expect(current.getScrollOffset()).toBe(0)
})
