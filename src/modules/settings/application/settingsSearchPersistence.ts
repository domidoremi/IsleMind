export const SETTINGS_SEARCH_SCHEMA = 'islemind.settings-search.v1' as const
export const SETTINGS_SEARCH_MAX_LENGTH = 512

export interface SettingsSearchRecord {
  schema: typeof SETTINGS_SEARCH_SCHEMA
  query: string
}

export interface SettingsSearchSnapshot {
  query: string
  hydrated: boolean
  pending: boolean
  failure: 'load' | 'save' | null
}

export interface SettingsSearchPersistence {
  getSnapshot(): SettingsSearchSnapshot
  subscribe(listener: () => void): () => void
  load(): Promise<void>
  setQuery(query: string): Promise<void>
  retry(): Promise<void>
}

export function normalizeSettingsSearchQuery(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, SETTINGS_SEARCH_MAX_LENGTH) : ''
}

export function createSettingsSearchPersistence(records: {
  read(): Promise<unknown | null>
  write(record: SettingsSearchRecord): Promise<void>
}): SettingsSearchPersistence {
  let snapshot: SettingsSearchSnapshot = { query: '', hydrated: false, pending: false, failure: null }
  let revision = 0
  let loading: Promise<void> | undefined
  let mutationTail: Promise<void> = Promise.resolve()
  const listeners = new Set<() => void>()

  function update(patch: Partial<SettingsSearchSnapshot>) {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }

  function load(): Promise<void> {
    if (snapshot.hydrated) return Promise.resolve()
    if (loading) return loading
    const expectedRevision = revision
    loading = (async () => {
      try {
        const raw = await records.read()
        if (revision !== expectedRevision) return
        const record = raw as Partial<SettingsSearchRecord> | null
        const query = record?.schema === SETTINGS_SEARCH_SCHEMA ? normalizeSettingsSearchQuery(record.query) : ''
        update({ query, hydrated: true, failure: null })
      } catch (error) {
        if (revision === expectedRevision) update({ failure: 'load' })
        throw error
      } finally {
        loading = undefined
      }
    })()
    return loading
  }

  function setQuery(value: string): Promise<void> {
    const query = normalizeSettingsSearchQuery(value)
    const expectedRevision = ++revision
    update({ query, hydrated: true, pending: true, failure: null })
    // This record is separate from execution settings: typing never changes a
    // provider, consent, model selection or a route-invalidation prerequisite.
    const result = mutationTail.then(() => records.write({ schema: SETTINGS_SEARCH_SCHEMA, query }))
    mutationTail = result.catch(() => undefined)
    return result.then(() => {
      if (revision === expectedRevision) update({ pending: false, failure: null })
    }, (error) => {
      if (revision === expectedRevision) update({ pending: false, failure: 'save' })
      throw error
    })
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load,
    setQuery,
    retry: () => snapshot.failure === 'save' ? setQuery(snapshot.query) : load(),
  })
}
