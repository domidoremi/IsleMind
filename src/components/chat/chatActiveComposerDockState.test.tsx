import { act, renderHook } from '@testing-library/react-native'

import { useChatStore } from '@/store/chatStore'
import type { Conversation } from '@/types/chatContracts'

import { useChatActiveComposerDockState } from './chatActiveComposerDockState'

jest.mock('@/store/chatStore', () => ({
  useChatStore: require('zustand').create(() => ({ conversations: [] })),
}))
jest.mock('@/presentation/features/conversations/conversationMessageCommand', () => ({ sendConversationMessage: jest.fn() }))
jest.mock('@/services/conversationLock', () => ({ isConversationLocked: () => false }))
jest.mock('./chatStreamingIntentActions', () => ({
  useChatStreamingSubmitActions: () => ({ submit: jest.fn(), submitWhileStreaming: jest.fn() }),
}))
jest.mock('./runtimeRepairIntentActions', () => ({ useRuntimeRepairIntentActions: () => ({}) }))

function conversation(id = 'first', systemPrompt = 'Original prompt'): Conversation {
  return { id, title: id, providerId: 'provider', model: 'model', systemPrompt,
    temperature: 0.7, maxTokens: 512, messages: [], createdAt: 1, updatedAt: 1 }
}

function replacePrompt(id: string, systemPrompt: string) {
  useChatStore.setState(state => ({ conversations: state.conversations.map(row => row.id === id ? { ...row, systemPrompt } : row) }))
}

function mount(initialId = 'first') {
  const updateConversation = jest.fn((id: string, patch: Partial<Conversation>) => {
    if (updateConversation.mock.calls.length > 12) throw new Error('Unbounded prompt writeback')
    useChatStore.setState(state => ({ conversations: state.conversations.map(row => row.id === id ? { ...row, ...patch } : row) }))
  })
  const callback = jest.fn()
  const props = {
    initialDraftKey: initialId, intentDraft: null, composerOutputMode: 'auto' as const, composerPanel: null, showOptions: false, keyboardVisible: false,
    setPendingStreamingMessage: callback, setComposerPanel: callback, collapseQuickTools: callback, markChromeActive: callback,
    updateConversation, setIntentDraft: callback, setPagerGestureLocked: callback, setShowOptions: callback,
    setComposerFocused: callback, setChromeCollapsed: callback, onApplyStarter: callback, safeStopMessage: callback,
    scrollToLatestMessage: callback,
  }
  const view = renderHook<ReturnType<typeof useChatActiveComposerDockState>, { id: string }>(({ id }) => {
    const current = useChatStore(state => state.conversations.find(row => row.id === id)!)
    return useChatActiveComposerDockState({ ...props, conversation: current })
  }, { initialProps: { id: initialId } })
  return { view, updateConversation }
}

beforeEach(() => {
  jest.useFakeTimers()
  useChatStore.setState({ conversations: [conversation(), conversation('second', 'Second prompt')] })
})
afterEach(() => { jest.useRealTimers() })

it('accepts a scene prompt applied to the mounted conversation without writing the previous value back', async () => {
  const { view, updateConversation } = mount()
  const mounted = await view
  await act(() => replacePrompt('first', 'Applied scene prompt'))
  expect(mounted.result.current.systemPrompt).toBe('Applied scene prompt')
  expect(useChatStore.getState().conversations[0].systemPrompt).toBe('Applied scene prompt')
  expect(updateConversation).not.toHaveBeenCalled()
  await mounted.unmount()
  expect(updateConversation).not.toHaveBeenCalled()
})

it('leaves an external prompt intact when the editor unmounts before receiving its next props', async () => {
  const { view, updateConversation } = mount()
  const mounted = await view
  await act(async () => {
    replacePrompt('first', 'Concurrent scene prompt')
    await mounted.unmount()
  })
  expect(useChatStore.getState().conversations[0].systemPrompt).toBe('Concurrent scene prompt')
  expect(updateConversation).not.toHaveBeenCalled()
})

it('debounces actual typing and persists the latest prompt once', async () => {
  const { view, updateConversation } = mount()
  const mounted = await view
  await act(() => mounted.result.current.handleSystemPromptChange('First edit'))
  await act(() => mounted.result.current.handleSystemPromptChange('Latest edit'))
  expect(updateConversation).not.toHaveBeenCalled()
  await act(() => jest.advanceTimersByTime(400))
  expect(updateConversation).toHaveBeenCalledTimes(1)
  expect(updateConversation).toHaveBeenLastCalledWith('first', { systemPrompt: 'Latest edit' })
  expect(mounted.result.current.systemPrompt).toBe('Latest edit')
  await mounted.unmount()
  expect(updateConversation).toHaveBeenCalledTimes(1)
})

it('flushes a typed prompt before sending and cancels its later debounce', async () => {
  const { view, updateConversation } = mount()
  const mounted = await view
  await act(() => mounted.result.current.handleSystemPromptChange('Send this prompt'))
  await act(() => mounted.result.current.handleSend('message', []))
  expect(updateConversation).toHaveBeenCalledTimes(1)
  expect(useChatStore.getState().conversations[0].systemPrompt).toBe('Send this prompt')
  await act(() => jest.advanceTimersByTime(500))
  expect(updateConversation).toHaveBeenCalledTimes(1)
  await mounted.unmount()
})

it('flushes the previous conversation draft when switching and loads the next prompt', async () => {
  const { view, updateConversation } = mount()
  const mounted = await view
  await act(() => mounted.result.current.handleSystemPromptChange('Keep first edit'))
  await mounted.rerender({ id: 'second' })
  expect(updateConversation).toHaveBeenCalledTimes(1)
  expect(updateConversation).toHaveBeenCalledWith('first', { systemPrompt: 'Keep first edit' })
  expect(mounted.result.current.systemPrompt).toBe('Second prompt')
  expect(useChatStore.getState().conversations[1].systemPrompt).toBe('Second prompt')
  await mounted.unmount()
})

it('flushes a pending user edit once on unmount', async () => {
  const { view, updateConversation } = mount()
  const mounted = await view
  await act(() => mounted.result.current.handleSystemPromptChange('Keep final edit'))
  await mounted.unmount()
  expect(updateConversation).toHaveBeenCalledTimes(1)
  expect(useChatStore.getState().conversations[0].systemPrompt).toBe('Keep final edit')
  await act(() => jest.advanceTimersByTime(500))
  expect(updateConversation).toHaveBeenCalledTimes(1)
})

it('discards a pending edit when a scene changes its base prompt before the debounce fires', async () => {
  const { view, updateConversation } = mount()
  const mounted = await view
  await act(() => mounted.result.current.handleSystemPromptChange('Outdated local edit'))
  await act(() => {
    replacePrompt('first', 'New scene prompt')
    jest.advanceTimersByTime(400)
  })
  expect(useChatStore.getState().conversations[0].systemPrompt).toBe('New scene prompt')
  expect(mounted.result.current.systemPrompt).toBe('New scene prompt')
  expect(updateConversation).not.toHaveBeenCalled()
  await mounted.unmount()
})

it('accepts an explicitly cleared scene prompt without restoring old text', async () => {
  const { view, updateConversation } = mount()
  const mounted = await view
  await act(() => replacePrompt('first', ''))
  expect(mounted.result.current.systemPrompt).toBe('')
  expect(useChatStore.getState().conversations[0].systemPrompt).toBe('')
  expect(updateConversation).not.toHaveBeenCalled()
  await mounted.unmount()
})

it('does not write a pending prompt after its conversation was removed', async () => {
  const { view, updateConversation } = mount()
  const mounted = await view
  await act(() => mounted.result.current.handleSystemPromptChange('Removed draft'))
  await act(async () => {
    useChatStore.setState({ conversations: [conversation('second')] })
    await mounted.unmount()
  })
  expect(updateConversation).not.toHaveBeenCalled()
  expect(useChatStore.getState().conversations.map(row => row.id)).toEqual(['second'])
})
