import { resolveGlobalGenerationStatus } from '../globalGenerationStatusState'

describe('resolveGlobalGenerationStatus', () => {
  it('selects a live assistant stream without relying on the active page', () => {
    const status = resolveGlobalGenerationStatus([
      {
        id: 'conversation-1',
        title: 'Draft review',
        messages: [
          { id: 'user-1', role: 'user', status: 'done' },
          { id: 'assistant-1', role: 'assistant', status: 'streaming' },
        ],
      },
    ], new Map([['conversation-1:assistant-1', true]]))

    expect(status).toEqual({
      conversationId: 'conversation-1',
      conversationTitle: 'Draft review',
      messageId: 'assistant-1',
    })
  })

  it('ignores stale stream keys and terminal messages', () => {
    expect(resolveGlobalGenerationStatus([
      {
        id: 'conversation-1',
        title: 'Done',
        messages: [{ id: 'assistant-1', role: 'assistant', status: 'done' }],
      },
    ], new Map([['conversation-1:assistant-1', true]]))).toBeNull()
  })
})
