import { useRef } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { Pressable as MockPressable } from 'react-native'
import { ChatContextDraftProvider, usePublishChatContextDraft, useReadChatContextDraft, type ChatContextDraft } from './chatContextDraft'

function Publisher({ text, ready = true }: { text: string; ready?: boolean }) {
  usePublishChatContextDraft({ text, ready, attachmentCount: 2 })
  return null
}

function Reader({ capture }: { capture: (value: ChatContextDraft | undefined) => void }) {
  const read = useReadChatContextDraft()
  const renderCount = useRef(0)
  renderCount.current += 1
  return <MockPressable testID="read-context-draft" onPress={() => capture(read?.())} accessibilityLabel={String(renderCount.current)} />
}

it('reads the latest committed draft on demand without requiring storage', async () => {
  const capture = jest.fn()
  const tree = (text: string) => <ChatContextDraftProvider scopeKey="chat-a">
    <Publisher text={text} />
    <Reader capture={capture} />
  </ChatContextDraftProvider>
  const screen = await render(tree('first draft'))
  await screen.rerender(tree('latest draft'))
  await fireEvent.press(screen.getByTestId('read-context-draft'))
  expect(capture).toHaveBeenLastCalledWith({ ready: true, text: 'latest draft', attachmentCount: 2 })
})

it('isolates workspace readers and clears an unmounted publisher instead of exposing another chat', async () => {
  const capturedA = jest.fn()
  const capturedB = jest.fn()
  const tree = (publishA: boolean) => <>
    <ChatContextDraftProvider scopeKey="chat-a">
      {publishA ? <Publisher text="private draft a" /> : null}
      <Reader capture={capturedA} />
    </ChatContextDraftProvider>
    <ChatContextDraftProvider scopeKey="chat-b">
      <Publisher text="private draft b" ready={false} />
      <Reader capture={capturedB} />
    </ChatContextDraftProvider>
  </>
  const screen = await render(tree(true))
  const readers = screen.getAllByTestId('read-context-draft')
  await fireEvent.press(readers[0])
  await fireEvent.press(readers[1])
  expect(capturedA).toHaveBeenLastCalledWith({ ready: true, text: 'private draft a', attachmentCount: 2 })
  expect(capturedB).toHaveBeenLastCalledWith({ ready: false, text: 'private draft b', attachmentCount: 2 })
  await act(() => screen.rerender(tree(false)))
  await fireEvent.press(screen.getAllByTestId('read-context-draft')[0])
  expect(capturedA).toHaveBeenLastCalledWith(undefined)
})
