export const CONVERSATION_COMPOSER_DRAFT_SCHEMA = 'islemind.composer-drafts.v1' as const
export const CONVERSATION_COMPOSER_DRAFT_MAX_CONTENT_LENGTH = 12_000
export const CONVERSATION_COMPOSER_DRAFT_MAX_KEY_LENGTH = 128
export const CONVERSATION_COMPOSER_DRAFT_MAX_RECORDS = 24
export const CONVERSATION_COMPOSER_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1_000

export interface ConversationComposerDraftRecord {
  key: string
  content: string
  updatedAt: number
}

export interface ConversationComposerDraftEnvelope {
  schema: typeof CONVERSATION_COMPOSER_DRAFT_SCHEMA
  drafts: readonly ConversationComposerDraftRecord[]
}

export interface ConversationComposerDraftStoragePort {
  read(): Promise<unknown | null>
  write(envelope: ConversationComposerDraftEnvelope): Promise<void>
  remove(): Promise<void>
}

export interface ConversationComposerDraftPersistence {
  load(key: string): Promise<ConversationComposerDraftRecord | null>
  save(key: string, content: string, updatedAt?: number): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
}

export function createConversationComposerDraftPersistence(dependencies: {
  storage: ConversationComposerDraftStoragePort
  now?: () => number
}): ConversationComposerDraftPersistence {
  const now = dependencies.now ?? Date.now
  let records: Map<string, ConversationComposerDraftRecord> | undefined
  let loading: Promise<void> | undefined
  let mutationTail: Promise<void> = Promise.resolve()

  async function ensureLoaded(): Promise<void> {
    if (records) return
    loading ??= (async () => {
      const raw = await dependencies.storage.read()
      records = new Map(
        normalizeConversationComposerDraftEnvelope(raw, now())
          .map((record) => [record.key, record] as const),
      )
    })().finally(() => {
      loading = undefined
    })
    await loading
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(operation, operation)
    mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  async function persist(): Promise<void> {
    const current = records ?? new Map<string, ConversationComposerDraftRecord>()
    if (!current.size) {
      await dependencies.storage.remove()
      return
    }
    const drafts = [...current.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key))
      .slice(0, CONVERSATION_COMPOSER_DRAFT_MAX_RECORDS)
    await dependencies.storage.write({
      schema: CONVERSATION_COMPOSER_DRAFT_SCHEMA,
      drafts,
    })
  }

  return Object.freeze({
    async load(key: string): Promise<ConversationComposerDraftRecord | null> {
      const normalizedKey = normalizeConversationComposerDraftKey(key)
      if (!normalizedKey) return null
      await ensureLoaded()
      const record = records?.get(normalizedKey)
      return record ? { ...record } : null
    },

    save(key: string, content: string, updatedAt = now()): Promise<void> {
      return enqueue(async () => {
        const normalizedKey = normalizeConversationComposerDraftKey(key)
        if (!normalizedKey) return
        await ensureLoaded()
        const nextRecords = records ?? new Map<string, ConversationComposerDraftRecord>()
        const normalizedContent = normalizeConversationComposerDraftContent(content)
        if (!normalizedContent.trim()) {
          nextRecords.delete(normalizedKey)
        } else {
          nextRecords.set(normalizedKey, {
            key: normalizedKey,
            content: normalizedContent,
            updatedAt: normalizeConversationComposerDraftTimestamp(updatedAt, now()),
          })
        }
        records = new Map(
          [...nextRecords.entries()]
            .sort((left, right) => right[1].updatedAt - left[1].updatedAt || left[0].localeCompare(right[0]))
            .slice(0, CONVERSATION_COMPOSER_DRAFT_MAX_RECORDS),
        )
        await persist()
      })
    },

    remove(key: string): Promise<void> {
      return enqueue(async () => {
        const normalizedKey = normalizeConversationComposerDraftKey(key)
        if (!normalizedKey) return
        await ensureLoaded()
        records?.delete(normalizedKey)
        await persist()
      })
    },

    clear(): Promise<void> {
      return enqueue(async () => {
        // A reset can race with the first hydration read. Let that read settle
        // before replacing the in-memory snapshot, otherwise it could resurrect
        // records after the storage key has been removed.
        if (loading) {
          try {
            await loading
          } catch {
            // The reset still owns the authoritative removal below.
          }
        }
        records = new Map()
        await dependencies.storage.remove()
      })
    },
  })
}

export function normalizeConversationComposerDraftEnvelope(
  raw: unknown,
  now: number,
): readonly ConversationComposerDraftRecord[] {
  if (!raw || typeof raw !== 'object') return []
  const candidate = raw as { schema?: unknown; drafts?: unknown }
  if (candidate.schema !== CONVERSATION_COMPOSER_DRAFT_SCHEMA || !Array.isArray(candidate.drafts)) return []

  const unique = new Map<string, ConversationComposerDraftRecord>()
  for (const item of candidate.drafts) {
    if (!item || typeof item !== 'object') continue
    const value = item as Partial<ConversationComposerDraftRecord>
    const key = normalizeConversationComposerDraftKey(value.key)
    const content = normalizeConversationComposerDraftContent(value.content)
    if (!key || !content.trim() || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) continue
    const updatedAt = normalizeConversationComposerDraftTimestamp(value.updatedAt, now)
    if (now - updatedAt > CONVERSATION_COMPOSER_DRAFT_TTL_MS) continue
    const next = { key, content, updatedAt }
    const previous = unique.get(key)
    if (!previous || next.updatedAt >= previous.updatedAt) unique.set(key, next)
  }

  return [...unique.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key))
    .slice(0, CONVERSATION_COMPOSER_DRAFT_MAX_RECORDS)
}

export function normalizeConversationComposerDraftKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  return key && key.length <= CONVERSATION_COMPOSER_DRAFT_MAX_KEY_LENGTH ? key : null
}

export function normalizeConversationComposerDraftContent(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, CONVERSATION_COMPOSER_DRAFT_MAX_CONTENT_LENGTH)
}

function normalizeConversationComposerDraftTimestamp(value: number, now: number): number {
  if (!Number.isFinite(value)) return now
  return Math.min(Math.max(0, value), now)
}
