import { resolveMessageBubbleRowAlignment } from './messageBubbleLayout'

describe('message bubble row alignment', () => {
  it('always keeps user messages on the right and assistant messages on the left', () => {
    expect(resolveMessageBubbleRowAlignment('user')).toBe('flex-end')
    expect(resolveMessageBubbleRowAlignment('assistant')).toBe('flex-start')
  })
})
