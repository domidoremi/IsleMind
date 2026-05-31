import type { MemoryItem, MemorySourceKind, MemoryStatus } from '@/types'

export type Mem0EntityKey = 'user_id' | 'agent_id' | 'app_id' | 'run_id'
export type Mem0EntityScope = Partial<Record<Mem0EntityKey, string>>

export interface Mem0MemoryRecord extends Mem0EntityScope {
  id?: string
  memory?: string
  text?: string
  content?: string
  metadata?: Record<string, unknown>
  categories?: string[]
  created_at?: string | number
  updated_at?: string | number
}

export interface Mem0MemoryEnvelope {
  schema: 'islemind.mem0.v1'
  source: 'islemind'
  exported_at: string
  filters: Mem0EntityScope
  memories: Mem0MemoryRecord[]
}

export interface Mem0AddPayload extends Mem0EntityScope {
  messages: Array<{ role: 'user'; content: string }>
  metadata: Record<string, unknown>
  infer: false
}

const entityKeys: Mem0EntityKey[] = ['user_id', 'agent_id', 'app_id', 'run_id']
const memorySourceKinds: MemorySourceKind[] = ['manual', 'deterministic', 'model', 'imported', 'legacy']
const memoryStatuses: MemoryStatus[] = ['pending', 'active', 'disabled']

export function exportMemoriesAsMem0(
  memories: MemoryItem[],
  scope: Mem0EntityScope = {},
  exportedAt = new Date().toISOString()
): Mem0MemoryEnvelope {
  return {
    schema: 'islemind.mem0.v1',
    source: 'islemind',
    exported_at: exportedAt,
    filters: normalizeScope(scope),
    memories: memories.map((memory) => mapMemoryToMem0Record(memory, scope)),
  }
}

export function mapMemoryToMem0Record(memory: MemoryItem, scope: Mem0EntityScope = {}): Mem0MemoryRecord {
  const sourceKind = normalizeSourceKind(memory.sourceKind)
  return {
    id: memory.id,
    memory: memory.content,
    ...normalizeScope(scope),
    metadata: {
      source: 'islemind',
      islemind_id: memory.id,
      islemind_status: memory.status,
      islemind_source_kind: sourceKind,
      islemind_source_detail: memory.sourceDetail,
      islemind_confidence: memory.confidence,
      islemind_conversation_id: memory.conversationId,
      islemind_last_hit_at_ms: memory.lastHitAt,
      islemind_created_at_ms: memory.createdAt,
      islemind_updated_at_ms: memory.updatedAt,
    },
    categories: ['islemind', sourceKind, memory.status],
    created_at: toIsoString(memory.createdAt),
    updated_at: toIsoString(memory.updatedAt),
  }
}

export function buildMem0AddPayload(memory: MemoryItem, scope: Mem0EntityScope = {}): Mem0AddPayload {
  return {
    ...normalizeScope(scope),
    messages: [{ role: 'user', content: memory.content }],
    metadata: mapMemoryToMem0Record(memory, scope).metadata ?? {},
    infer: false,
  }
}

export function importMem0Memories(
  input: Mem0MemoryRecord[] | { results?: Mem0MemoryRecord[]; memories?: Mem0MemoryRecord[] },
  options: { defaultStatus?: MemoryStatus; now?: number } = {}
): MemoryItem[] {
  const records = Array.isArray(input) ? input : Array.isArray(input.memories) ? input.memories : Array.isArray(input.results) ? input.results : []
  return records
    .map((record) => mapMem0RecordToMemory(record, options))
    .filter((memory): memory is MemoryItem => memory !== null)
}

export function mapMem0RecordToMemory(
  record: Mem0MemoryRecord,
  options: { defaultStatus?: MemoryStatus; now?: number } = {}
): MemoryItem | null {
  const content = firstText(record.memory, record.text, record.content)
  if (!content) return null
  const metadata = record.metadata ?? {}
  const now = options.now ?? Date.now()
  const createdAt = parseTimestamp(metadata.islemind_created_at_ms, record.created_at) ?? now
  const updatedAt = parseTimestamp(metadata.islemind_updated_at_ms, record.updated_at) ?? createdAt
  const sourceKind = normalizeSourceKind(firstText(metadata.islemind_source_kind) ?? 'imported')
  const status = normalizeStatus(firstText(metadata.islemind_status) ?? options.defaultStatus ?? 'pending')
  return {
    id: firstText(metadata.islemind_id, record.id) ?? buildImportedMemoryId(content, record),
    content,
    status,
    conversationId: firstText(metadata.islemind_conversation_id),
    sourceKind,
    sourceDetail: firstText(metadata.islemind_source_detail) ?? describeMem0Scope(record),
    confidence: normalizeConfidence(metadata.islemind_confidence ?? metadata.confidence),
    lastHitAt: parseTimestamp(metadata.islemind_last_hit_at_ms),
    createdAt,
    updatedAt,
  }
}

function normalizeScope(scope: Mem0EntityScope): Mem0EntityScope {
  return Object.fromEntries(
    entityKeys
      .map((key) => [key, firstText(scope[key])] as const)
      .filter((entry): entry is readonly [Mem0EntityKey, string] => !!entry[1])
  )
}

function normalizeSourceKind(value: unknown): MemorySourceKind {
  const text = firstText(value)
  return memorySourceKinds.includes(text as MemorySourceKind) ? text as MemorySourceKind : 'imported'
}

function normalizeStatus(value: unknown): MemoryStatus {
  const text = firstText(value)
  return memoryStatuses.includes(text as MemoryStatus) ? text as MemoryStatus : 'pending'
}

function normalizeConfidence(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric)) return undefined
  return Math.max(0, Math.min(1, numeric))
}

function parseTimestamp(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
      const parsed = Date.parse(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text) return text
  }
  return undefined
}

function toIsoString(value: number): string {
  return new Date(value).toISOString()
}

function describeMem0Scope(record: Mem0MemoryRecord): string | undefined {
  const parts = entityKeys
    .map((key) => firstText(record[key]) ? `${key}=${firstText(record[key])}` : '')
    .filter(Boolean)
  return parts.length ? `mem0:${parts.join(',')}` : 'mem0'
}

function buildImportedMemoryId(content: string, record: Mem0MemoryRecord): string {
  return `mem0-${Math.abs(hashString([content, record.user_id, record.agent_id, record.app_id, record.run_id].filter(Boolean).join('|'))).toString(36)}`
}

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return hash
}
