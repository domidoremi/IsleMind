import { hasWideMessageContent, resolveMessageBubbleMaxWidth, resolveMessageBubbleRowAlignment } from './messageBubbleLayout'

describe('message bubble row alignment', () => {
  it('always keeps user messages on the right and assistant messages on the left', () => {
    expect(resolveMessageBubbleRowAlignment('user')).toBe('flex-end')
    expect(resolveMessageBubbleRowAlignment('assistant')).toBe('flex-start')
  })

  it('clamps wide bubbles to the list content box', () => {
    expect(resolveMessageBubbleMaxWidth('x'.repeat(200), 'assistant', true, 390)).toBeLessThanOrEqual(390 - 28)
    expect(resolveMessageBubbleMaxWidth('x'.repeat(200), 'user', false, 320)).toBeLessThanOrEqual(320 - 24)
    expect(resolveMessageBubbleMaxWidth('x'.repeat(200), 'assistant', true, 180)).toBeLessThanOrEqual(180)
  })

  it('marks code, tables, and long lines as wide content', () => {
    expect(hasWideMessageContent('```\nconst value = 1\n```')).toBe(true)
    expect(hasWideMessageContent('| A | B |\n| - | - |')).toBe(true)
    expect(hasWideMessageContent('a'.repeat(89))).toBe(true)
  })
})
