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

  it('measures both roles against the reading column instead of the viewport', () => {
    const wideAssistant = resolveMessageBubbleMaxWidth('x'.repeat(200), 'assistant', true, 1440)
    const columnAssistant = resolveMessageBubbleMaxWidth('x'.repeat(200), 'assistant', true, 880)
    const wideUser = resolveMessageBubbleMaxWidth('x'.repeat(200), 'user', true, 1440)
    expect(wideAssistant).toBe(columnAssistant)
    expect(wideAssistant).toBeLessThanOrEqual(880)
    expect(wideUser).toBeLessThan(wideAssistant)
  })

  it('treats the user bubble as an upper bound instead of a fixed width', () => {
    const short = resolveMessageBubbleMaxWidth('好', 'user', false, 1440)
    const long = resolveMessageBubbleMaxWidth('好'.repeat(200), 'user', false, 1440)
    expect(short).toBeLessThan(long)
  })

  it('promotes a turn whose longest unbreakable run cannot fit a narrower measure', () => {
    const unbreakable = resolveMessageBubbleMaxWidth('a'.repeat(60), 'assistant', false, 1440)
    const breakable = resolveMessageBubbleMaxWidth('好'.repeat(60), 'assistant', false, 1440)
    expect(unbreakable).toBeGreaterThan(breakable)
  })

  it('does not treat a CJK sentence as one unbreakable run', () => {
    const cjk = resolveMessageBubbleMaxWidth('这次重构把首页改成连续会话画布', 'assistant', false, 1440)
    const latin = resolveMessageBubbleMaxWidth('a'.repeat(15), 'assistant', false, 1440)
    expect(cjk).toBe(latin)
  })

  it('never exceeds the role bound even when a run is wider than the column', () => {
    const bound = resolveMessageBubbleMaxWidth('x'.repeat(200), 'assistant', true, 390)
    expect(resolveMessageBubbleMaxWidth('a'.repeat(80), 'assistant', false, 390)).toBeLessThanOrEqual(bound)
  })

  it('marks code, tables, and long lines as wide content', () => {
    expect(hasWideMessageContent('```\nconst value = 1\n```')).toBe(true)
    expect(hasWideMessageContent('| A | B |\n| - | - |')).toBe(true)
    expect(hasWideMessageContent('a'.repeat(89))).toBe(true)
  })
})
