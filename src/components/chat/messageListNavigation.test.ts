import {
  buildAssistantNavigationItems,
  sampleAssistantNavigationIndices,
} from './messageListNavigation'

import type { Message } from '@/types/chatContracts'

function message(id: string, role: Message['role'], content = 'one\n\ntwo'): Message {
  return {
    id,
    role,
    content,
    timestamp: 0,
    status: 'done',
  }
}

describe('message list navigation', () => {
  it('indexes assistant replies without changing their message-list positions', () => {
    const items = buildAssistantNavigationItems([
      message('u-1', 'user', 'question'),
      message('a-1', 'assistant'),
      message('u-2', 'user', 'follow up'),
      message('a-2', 'assistant', 'answer'),
    ])

    expect(items).toEqual([
      {
        messageId: 'a-1',
        messageIndex: 1,
        assistantIndex: 1,
        assistantCount: 2,
        paragraphCount: 2,
      },
      {
        messageId: 'a-2',
        messageIndex: 3,
        assistantIndex: 2,
        assistantCount: 2,
        paragraphCount: 1,
      },
    ])
  })

  it('keeps the first, last, and active markers while bounding long tracks', () => {
    const markers = sampleAssistantNavigationIndices(500, 317, 12)

    expect(markers.length).toBeLessThanOrEqual(12)
    expect(markers[0]).toBe(0)
    expect(markers.at(-1)).toBe(499)
    expect(markers).toContain(317)
    expect([...markers].sort((left, right) => left - right)).toEqual(markers)
  })

  it('normalizes empty and small marker sets', () => {
    expect(sampleAssistantNavigationIndices(0)).toEqual([])
    expect(sampleAssistantNavigationIndices(3, 2, 2)).toEqual([0, 1, 2])
  })
})
