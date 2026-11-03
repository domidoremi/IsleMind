import { act, renderHook } from '@testing-library/react-native'
import { CHAT_PRESENTATION_CATALOG } from '@/presentation/features/chat/chatPresentationCatalog'
import { resolveChatEntryDraftAction, useChatEntryTasks } from './useChatEntryTasks'
import type { ComposerDraftPresence } from './composerDraftState'

it('does not prepare a starter until existing draft hydration completes', () => {
  expect(resolveChatEntryDraftAction('loading')).toBe('wait')
  expect(resolveChatEntryDraftAction('draft')).toBe('preserve')
  expect(resolveChatEntryDraftAction('empty')).toBe('prepare')
})

it('separates task browsing from explicit preparation and keeps an existing draft untouched', async () => {
  const onStarter = jest.fn()
  const view = await renderHook(({ presence }: { presence: ComposerDraftPresence }) => useChatEntryTasks(presence, onStarter),
    { initialProps: { presence: 'loading' as ComposerDraftPresence } })
  await act(() => {
    view.result.current.select('draft')
    view.result.current.prepare()
  })
  expect(onStarter).not.toHaveBeenCalled()
  await view.rerender({ presence: 'empty' })
  expect(view.result.current.selected.id).toBe('draft')
  await act(() => view.result.current.prepare())
  expect(onStarter).toHaveBeenCalledWith(CHAT_PRESENTATION_CATALOG.starters[2])
  await view.rerender({ presence: 'draft' })
  await act(() => {
    view.result.current.select('analyze')
    view.result.current.prepare()
  })
  expect(view.result.current.selected.id).toBe('analyze')
  expect(onStarter).toHaveBeenCalledTimes(1)
})
