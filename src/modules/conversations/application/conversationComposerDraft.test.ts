import {
  CONVERSATION_COMPOSER_DRAFT_MAX_RECORDS,
  CONVERSATION_COMPOSER_DRAFT_SCHEMA,
  CONVERSATION_COMPOSER_DRAFT_TTL_MS,
  createConversationComposerDraftPersistence,
  normalizeConversationComposerDraftEnvelope,
} from './conversationComposerDraft'

describe('conversation composer draft persistence', () => {
  it('normalizes untrusted records, removes stale entries, and keeps the newest bounded set', () => {
    const now = CONVERSATION_COMPOSER_DRAFT_TTL_MS + 10_000
    const drafts = normalizeConversationComposerDraftEnvelope({
      schema: CONVERSATION_COMPOSER_DRAFT_SCHEMA,
      drafts: [
        { key: 'keep', content: 'latest', updatedAt: now },
        { key: 'keep', content: 'older', updatedAt: now - 1 },
        { key: 'stale', content: 'old', updatedAt: now - CONVERSATION_COMPOSER_DRAFT_TTL_MS - 1 },
        { key: 'blank', content: '   ', updatedAt: now },
        null,
      ],
    }, now)

    expect(drafts).toEqual([{ key: 'keep', content: 'latest', updatedAt: now }])
  })

  it('coalesces concurrent reads and serializes saves/removals', async () => {
    let reads = 0
    const writes: unknown[] = []
    let stored: unknown = null
    const persistence = createConversationComposerDraftPersistence({
      now: () => 100,
      storage: {
        read: async () => {
          reads += 1
          return stored
        },
        write: async (envelope) => {
          writes.push(envelope)
          stored = envelope
        },
        remove: async () => {
          stored = null
        },
      },
    })

    await Promise.all([
      persistence.save('conversation-1', 'first', 1),
      persistence.save('conversation-2', 'second', 2),
    ])
    expect(reads).toBe(1)
    expect(writes).toHaveLength(2)
    await expect(persistence.load('conversation-2')).resolves.toMatchObject({ content: 'second' })
    await persistence.remove('conversation-1')
    await expect(persistence.load('conversation-1')).resolves.toBeNull()
  })

  it('does not resurrect cached records when reset races the first read', async () => {
    let resolveRead!: (value: unknown) => void
    let stored: unknown = {
      schema: CONVERSATION_COMPOSER_DRAFT_SCHEMA,
      drafts: [{ key: 'conversation-1', content: 'stale', updatedAt: 1 }],
    }
    const readPromise = new Promise<unknown>((resolve) => {
      resolveRead = resolve
    })
    const persistence = createConversationComposerDraftPersistence({
      now: () => 100,
      storage: {
        read: async () => readPromise,
        write: async (envelope) => { stored = envelope },
        remove: async () => { stored = null },
      },
    })

    const loading = persistence.load('conversation-1')
    const clearing = persistence.clear()
    resolveRead(stored)
    await Promise.all([loading, clearing])

    await expect(persistence.load('conversation-1')).resolves.toBeNull()
    expect(stored).toBeNull()
  })

  it('bounds the persisted record count', async () => {
    let stored: any = null
    const persistence = createConversationComposerDraftPersistence({
      now: () => 1_000,
      storage: {
        read: async () => stored,
        write: async (envelope) => { stored = envelope },
        remove: async () => { stored = null },
      },
    })

    for (let index = 0; index < CONVERSATION_COMPOSER_DRAFT_MAX_RECORDS + 3; index += 1) {
      await persistence.save(`draft-${index}`, `value-${index}`, index + 1)
    }
    expect(stored.drafts).toHaveLength(CONVERSATION_COMPOSER_DRAFT_MAX_RECORDS)
    expect(stored.drafts[0].key).toBe(`draft-${CONVERSATION_COMPOSER_DRAFT_MAX_RECORDS + 2}`)
  })
})
