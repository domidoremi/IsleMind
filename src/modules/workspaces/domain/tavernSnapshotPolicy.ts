import { TAVERN_SNAPSHOT_SCHEMA } from './tavernContracts'
import type {
  TavernCharacterCard,
  TavernCharacterDraftProposal,
  TavernLorebookDraftProposal,
  TavernLorebookEntry,
  TavernNarrativeSummary,
  TavernPendingWriteback,
  TavernRelationshipMemory,
  TavernRelationshipMemoryCandidate,
  TavernRelationshipMemoryKind,
  TavernRelationshipMemoryRetentionClass,
  TavernRelationshipMemoryReviewStatus,
  TavernScene,
  TavernSceneChangeProposal,
  TavernSnapshot,
  TavernTurnWritebackSummaryDraft,
} from './tavernContracts'

const TEXT_LIMIT = 2400
const SHORT_TEXT_LIMIT = 180
export const TAVERN_SNAPSHOT_LIST_LIMIT = 48
const LIST_LIMIT = TAVERN_SNAPSHOT_LIST_LIMIT

export function createEmptyTavernSnapshot(now = Date.now()): TavernSnapshot {
  return {
    schema: TAVERN_SNAPSHOT_SCHEMA,
    characters: [],
    lorebook: [],
    relationshipMemories: [],
    scenes: [],
    narrativeSummaries: [],
    pendingWritebacks: [],
    updatedAt: now,
  }
}

export function normalizeTavernSnapshot(value: unknown, now = Date.now()): TavernSnapshot {
  if (!value || typeof value !== 'object') return createEmptyTavernSnapshot(now)
  const input = value as Partial<TavernSnapshot>
  return {
    schema: TAVERN_SNAPSHOT_SCHEMA,
    characters: normalizeUniqueById(input.characters, normalizeTavernCharacterCard, now),
    lorebook: normalizeUniqueById(input.lorebook, normalizeTavernLorebookEntry, now).sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt),
    relationshipMemories: normalizeUniqueById(input.relationshipMemories, normalizeRelationshipMemory, now).sort((a, b) => b.weight - a.weight || b.updatedAt - a.updatedAt),
    scenes: normalizeUniqueById(input.scenes, normalizeScene, now),
    narrativeSummaries: normalizeUniqueById(input.narrativeSummaries, normalizeNarrativeSummary, now).sort((a, b) => b.updatedAt - a.updatedAt),
    pendingWritebacks: normalizeUniqueById(input.pendingWritebacks, normalizePendingWriteback, now).sort((a, b) => b.updatedAt - a.updatedAt),
    updatedAt: finiteTimestamp(input.updatedAt) ?? now,
  }
}

export function upsertTavernCharacter(snapshot: TavernSnapshot, draft: Partial<TavernCharacterCard>, now = Date.now()): TavernSnapshot {
  const next = normalizeTavernCharacterCard({ ...draft, updatedAt: now, createdAt: draft.createdAt ?? now }, now)
  return replaceById(snapshot, 'characters', next, now)
}

export function upsertTavernLorebookEntry(snapshot: TavernSnapshot, draft: Partial<TavernLorebookEntry>, now = Date.now()): TavernSnapshot {
  const next = normalizeTavernLorebookEntry({ ...draft, updatedAt: now, createdAt: draft.createdAt ?? now }, now)
  return replaceById(snapshot, 'lorebook', next, now)
}

export function upsertTavernRelationshipMemory(snapshot: TavernSnapshot, draft: Partial<TavernRelationshipMemory>, now = Date.now()): TavernSnapshot {
  const next = normalizeRelationshipMemory({ ...draft, updatedAt: now, createdAt: draft.createdAt ?? now }, now)
  return replaceById(snapshot, 'relationshipMemories', next, now)
}

export function upsertTavernScene(snapshot: TavernSnapshot, draft: Partial<TavernScene>, now = Date.now()): TavernSnapshot {
  const next = normalizeScene({ ...draft, updatedAt: now, createdAt: draft.createdAt ?? now }, now)
  return replaceById(snapshot, 'scenes', next, now)
}

export function upsertTavernNarrativeSummary(snapshot: TavernSnapshot, draft: Partial<TavernNarrativeSummary>, now = Date.now()): TavernSnapshot {
  const next = normalizeNarrativeSummary({ ...draft, updatedAt: now, createdAt: draft.createdAt ?? now }, now)
  return replaceById(snapshot, 'narrativeSummaries', next, now)
}

export function upsertTavernPendingWriteback(snapshot: TavernSnapshot, draft: Partial<TavernPendingWriteback>, now = Date.now()): TavernSnapshot {
  const next = normalizePendingWriteback({ ...draft, updatedAt: now, createdAt: draft.createdAt ?? now }, now)
  return replaceById(snapshot, 'pendingWritebacks', next, now)
}

export type TavernSnapshotCollection = keyof Pick<
  TavernSnapshot,
  'characters' | 'lorebook' | 'relationshipMemories' | 'scenes' | 'narrativeSummaries' | 'pendingWritebacks'
>

export function deleteTavernItem(
  snapshot: TavernSnapshot,
  collection: TavernSnapshotCollection,
  id: string,
  now = Date.now(),
): TavernSnapshot {
  return {
    ...snapshot,
    [collection]: snapshot[collection].filter((item) => item.id !== id),
    updatedAt: now,
  }
}
export function normalizeTavernCharacterCard(value: Partial<TavernCharacterCard> | undefined, now: number): TavernCharacterCard | null {
  const name = normalizeText(value?.name, SHORT_TEXT_LIMIT)
  if (!name) return null
  const id = normalizeId(value?.id) ?? generateTavernId('character', name, now)
  return {
    id,
    name,
    avatarUri: normalizeText(value?.avatarUri, TEXT_LIMIT),
    persona: normalizeText(value?.persona, TEXT_LIMIT) ?? '',
    speechStyle: normalizeText(value?.speechStyle, TEXT_LIMIT) ?? '',
    background: normalizeText(value?.background, TEXT_LIMIT) ?? '',
    openingMessage: normalizeText(value?.openingMessage, TEXT_LIMIT),
    constraints: normalizeTextList(value?.constraints),
    tags: normalizeTextList(value?.tags),
    createdAt: finiteTimestamp(value?.createdAt) ?? now,
    updatedAt: finiteTimestamp(value?.updatedAt) ?? now,
  }
}

export function normalizeTavernLorebookEntry(value: Partial<TavernLorebookEntry> | undefined, now: number): TavernLorebookEntry | null {
  const title = normalizeText(value?.title, SHORT_TEXT_LIMIT)
  const content = normalizeText(value?.content, TEXT_LIMIT)
  if (!title || !content) return null
  return {
    id: normalizeId(value?.id) ?? generateTavernId('lore', title, now),
    title,
    content,
    keywords: normalizeTextList(value?.keywords).slice(0, 24),
    priority: clampNumber(value?.priority, 0, 100, 50),
    enabled: value?.enabled !== false,
    createdAt: finiteTimestamp(value?.createdAt) ?? now,
    updatedAt: finiteTimestamp(value?.updatedAt) ?? now,
  }
}

function normalizeRelationshipMemory(value: Partial<TavernRelationshipMemory> | undefined, now: number): TavernRelationshipMemory | null {
  const characterId = normalizeId(value?.characterId)
  const content = normalizeText(value?.content, TEXT_LIMIT)
  if (!characterId || !content) return null
  return {
    id: normalizeId(value?.id) ?? generateTavernId('memory', `${characterId}:${content}`, now),
    characterId,
    kind: normalizeRelationshipKind(value?.kind),
    content,
    weight: clampNumber(value?.weight, 0, 1, 0.5),
    userVisible: value?.userVisible !== false,
    createdAt: finiteTimestamp(value?.createdAt) ?? now,
    updatedAt: finiteTimestamp(value?.updatedAt) ?? now,
  }
}

function normalizeScene(value: Partial<TavernScene> | undefined, now: number): TavernScene | null {
  const title = normalizeText(value?.title, SHORT_TEXT_LIMIT)
  const location = normalizeText(value?.location, SHORT_TEXT_LIMIT)
  if (!title && !location) return null
  return {
    id: normalizeId(value?.id) ?? generateTavernId('scene', `${title}:${location}`, now),
    title: title ?? 'Tavern scene',
    location: location ?? 'Tavern',
    branchFromSceneId: normalizeId(value?.branchFromSceneId),
    timeOfDay: normalizeText(value?.timeOfDay, SHORT_TEXT_LIMIT),
    mood: normalizeText(value?.mood, SHORT_TEXT_LIMIT),
    narrativeGoal: normalizeText(value?.narrativeGoal, TEXT_LIMIT),
    activeCharacterIds: normalizeTextList(value?.activeCharacterIds).map((item) => normalizeId(item)).filter(isString),
    narratorStyle: normalizeText(value?.narratorStyle, SHORT_TEXT_LIMIT),
    speakingOrder: normalizeTextList(value?.speakingOrder).map((item) => normalizeId(item) ?? item).filter(isString),
    createdAt: finiteTimestamp(value?.createdAt) ?? now,
    updatedAt: finiteTimestamp(value?.updatedAt) ?? now,
  }
}

function normalizeNarrativeSummary(value: Partial<TavernNarrativeSummary> | undefined, now: number): TavernNarrativeSummary | null {
  const summary = normalizeText(value?.summary, TEXT_LIMIT)
  if (!summary) return null
  return {
    id: normalizeId(value?.id) ?? generateTavernId('summary', summary, now),
    sceneId: normalizeId(value?.sceneId),
    chapterTitle: normalizeText(value?.chapterTitle, SHORT_TEXT_LIMIT),
    summary,
    unresolvedThreads: normalizeTextList(value?.unresolvedThreads),
    promises: normalizeTextList(value?.promises),
    importantChanges: normalizeTextList(value?.importantChanges),
    createdAt: finiteTimestamp(value?.createdAt) ?? now,
    updatedAt: finiteTimestamp(value?.updatedAt) ?? now,
  }
}

function normalizePendingWriteback(value: Partial<TavernPendingWriteback> | undefined, now: number): TavernPendingWriteback | null {
  const candidates = normalizeUniqueById(value?.relationshipMemoryCandidates, normalizeRelationshipMemoryCandidate, now)
  const sceneChangeProposal = normalizeSceneChangeProposal(value?.sceneChangeProposal)
  const characterDraftProposal = normalizeCharacterDraftProposal(value?.characterDraftProposal, now)
  const lorebookDraftProposal = normalizeLorebookDraftProposal(value?.lorebookDraftProposal, now)
  const sourceAssistantMessageId = normalizeId(value?.sourceAssistantMessageId)
  const summaryDraft = normalizeTurnWritebackSummaryDraft(value?.summaryDraft, now)
  if (!candidates.length && !sceneChangeProposal && !summaryDraft && !characterDraftProposal && !lorebookDraftProposal) return null
  return {
    id: normalizeId(value?.id) ?? generateTavernId('pending-writeback', sourceAssistantMessageId ?? characterDraftProposal?.id ?? lorebookDraftProposal?.id ?? candidates.map((candidate) => candidate.id).join(':'), now),
    sourceAssistantMessageId,
    summaryDraft,
    characterDraftProposal,
    lorebookDraftProposal,
    relationshipMemoryCandidates: candidates,
    sceneChangeProposal,
    evidence: normalizeTextList(value?.evidence),
    createdAt: finiteTimestamp(value?.createdAt) ?? now,
    updatedAt: finiteTimestamp(value?.updatedAt) ?? now,
  }
}

function normalizeLorebookDraftProposal(value: Partial<TavernLorebookDraftProposal> | undefined, now: number): TavernLorebookDraftProposal | undefined {
  if (!value) return undefined
  const title = normalizeText(value.title, SHORT_TEXT_LIMIT)
  const content = normalizeText(value.content, TEXT_LIMIT)
  if (!title || !content) return undefined
  return {
    id: normalizeId(value.id) ?? generateTavernId('lore-draft', `${title}:${content}`, now),
    loreId: normalizeId(value.loreId),
    title,
    content,
    keywords: normalizeTextList(value.keywords).slice(0, 24),
    priority: value.priority === undefined ? undefined : clampNumber(value.priority, 0, 100, 50),
    enabled: value.enabled === false ? false : undefined,
    reason: normalizeText(value.reason, TEXT_LIMIT) ?? 'User confirmation is required before saving lore.',
    requiresUserConfirmation: true,
  }
}

function normalizeCharacterDraftProposal(value: Partial<TavernCharacterDraftProposal> | undefined, now: number): TavernCharacterDraftProposal | undefined {
  if (!value) return undefined
  const name = normalizeText(value.name, SHORT_TEXT_LIMIT)
  const persona = normalizeText(value.persona, TEXT_LIMIT)
  const speechStyle = normalizeText(value.speechStyle, TEXT_LIMIT)
  const background = normalizeText(value.background, TEXT_LIMIT)
  const openingMessage = normalizeText(value.openingMessage, TEXT_LIMIT)
  if (!name || (!persona && !speechStyle && !background && !openingMessage)) return undefined
  return {
    id: normalizeId(value.id) ?? generateTavernId('character-draft', `${name}:${persona ?? speechStyle ?? background ?? openingMessage}`, now),
    characterId: normalizeId(value.characterId),
    name,
    persona,
    speechStyle,
    background,
    openingMessage,
    constraints: normalizeTextList(value.constraints),
    tags: normalizeTextList(value.tags),
    reason: normalizeText(value.reason, TEXT_LIMIT) ?? 'Detected a conversational character-shaping summary. User confirmation is required before saving the character card.',
    requiresUserConfirmation: true,
  }
}

function normalizeRelationshipMemoryCandidate(value: Partial<TavernRelationshipMemoryCandidate> | undefined, now: number): TavernRelationshipMemoryCandidate | null {
  const content = normalizeText(value?.content, TEXT_LIMIT)
  if (!content) return null
  const characterId = normalizeId(value?.characterId)
  const unresolvedCharacterRef = normalizeText(value?.unresolvedCharacterRef, SHORT_TEXT_LIMIT)
  const kind = normalizeRelationshipKind(value?.kind)
  return {
    id: normalizeId(value?.id) ?? generateTavernId('memory-candidate', `${characterId ?? unresolvedCharacterRef ?? 'unknown'}:${content}`, now),
    characterId,
    unresolvedCharacterRef,
    kind,
    content,
    suggestedUserVisible: value?.suggestedUserVisible !== false,
    confidence: clampNumber(value?.confidence, 0, 1, 0.55),
    retentionClass: normalizeRelationshipMemoryRetentionClass(value?.retentionClass, kind),
    reviewStatus: normalizeRelationshipMemoryReviewStatus(value?.reviewStatus),
    relatedMemoryId: normalizeId(value?.relatedMemoryId),
    reason: normalizeText(value?.reason, TEXT_LIMIT) ?? 'User confirmation is required before persistence.',
    requiresUserConfirmation: true,
  }
}

function normalizeSceneChangeProposal(value: Partial<TavernSceneChangeProposal> | undefined): TavernSceneChangeProposal | undefined {
  if (!value) return undefined
  const narrativeGoal = normalizeText(value.narrativeGoal, TEXT_LIMIT)
  const title = normalizeText(value.title, SHORT_TEXT_LIMIT)
  const location = normalizeText(value.location, SHORT_TEXT_LIMIT)
  const timeOfDay = normalizeText(value.timeOfDay, SHORT_TEXT_LIMIT)
  const mood = normalizeText(value.mood, SHORT_TEXT_LIMIT)
  const activeCharacterIds = normalizeTextList(value.activeCharacterIds).map((item) => normalizeId(item)).filter(isString)
  const unresolvedCharacterRefs = normalizeTextList(value.unresolvedCharacterRefs)
  const narratorStyle = normalizeText(value.narratorStyle, SHORT_TEXT_LIMIT)
  const speakingOrder = normalizeTextList(value.speakingOrder).map((item) => normalizeId(item) ?? item).filter(isString)
  const unresolvedSpeakingOrderRefs = normalizeTextList(value.unresolvedSpeakingOrderRefs)
  const createNewScene = value.createNewScene === true
  const branchFromSceneId = normalizeId(value.branchFromSceneId)
  const unresolvedSceneRef = normalizeText(value.unresolvedSceneRef, SHORT_TEXT_LIMIT)
  const unresolvedBranchFromSceneRef = normalizeText(value.unresolvedBranchFromSceneRef, SHORT_TEXT_LIMIT)
  if (!narrativeGoal && !title && !location && !timeOfDay && !mood && !activeCharacterIds.length && !narratorStyle && !speakingOrder.length && !unresolvedSceneRef && !unresolvedBranchFromSceneRef) return undefined
  return {
    sceneId: createNewScene ? undefined : normalizeId(value.sceneId),
    unresolvedSceneRef,
    createNewScene: createNewScene || undefined,
    branchFromSceneId,
    unresolvedBranchFromSceneRef,
    title,
    location,
    timeOfDay,
    mood,
    narrativeGoal,
    activeCharacterIds: activeCharacterIds.length ? activeCharacterIds : undefined,
    unresolvedCharacterRefs: unresolvedCharacterRefs.length ? unresolvedCharacterRefs : undefined,
    narratorStyle,
    speakingOrder: speakingOrder.length ? speakingOrder : undefined,
    unresolvedSpeakingOrderRefs: unresolvedSpeakingOrderRefs.length ? unresolvedSpeakingOrderRefs : undefined,
    reason: normalizeText(value.reason, TEXT_LIMIT) ?? 'User confirmation is required before changing scene state.',
    requiresUserConfirmation: true,
  }
}

function normalizeTurnWritebackSummaryDraft(value: Partial<TavernTurnWritebackSummaryDraft> | undefined, now: number): TavernTurnWritebackSummaryDraft | undefined {
  const summary = normalizeText(value?.summary, TEXT_LIMIT)
  if (!summary) return undefined
  return {
    id: normalizeId(value?.id) ?? generateTavernId('summary-draft', summary, now),
    sceneId: normalizeId(value?.sceneId),
    chapterTitle: normalizeText(value?.chapterTitle, SHORT_TEXT_LIMIT),
    summary,
    unresolvedThreads: normalizeTextList(value?.unresolvedThreads),
    promises: normalizeTextList(value?.promises),
    importantChanges: normalizeTextList(value?.importantChanges),
  }
}

function normalizeUniqueById<T>(values: T[] | undefined, normalize: (value: Partial<T>, now: number) => T | null, now: number): T[] {
  if (!Array.isArray(values)) return []
  const byId = new Map<string, T>()
  for (const value of values.slice(0, LIST_LIMIT)) {
    const normalized = normalize(value as Partial<T>, now) as (T & { id: string }) | null
    if (normalized) byId.set(normalized.id, normalized)
  }
  return Array.from(byId.values())
}

function replaceById<K extends 'characters' | 'lorebook' | 'relationshipMemories' | 'scenes' | 'narrativeSummaries' | 'pendingWritebacks'>(
  snapshot: TavernSnapshot,
  collection: K,
  item: TavernSnapshot[K][number] | null,
  now: number
): TavernSnapshot {
  if (!item) return { ...snapshot, updatedAt: now }
  const items = snapshot[collection].filter((candidate) => candidate.id !== item.id)
  return normalizeTavernSnapshot({
    ...snapshot,
    [collection]: [item, ...items],
    updatedAt: now,
  }, now)
}

export function parseCanonicalTavernSnapshot(value: unknown): TavernSnapshot | undefined {
  const input = asRecord(value)
  const updatedAt = finiteTimestamp(input?.updatedAt)
  if (!input || input.schema !== TAVERN_SNAPSHOT_SCHEMA || updatedAt === undefined) return undefined
  const normalized = normalizeTavernSnapshot(value, updatedAt)
  return JSON.stringify(normalized) === JSON.stringify(value) ? normalized : undefined
}

export function cloneCanonicalTavernSnapshot(snapshot: TavernSnapshot): TavernSnapshot {
  const parsed = parseCanonicalTavernSnapshot(JSON.parse(JSON.stringify(snapshot)))
  if (!parsed) throw new Error('The Tavern workspace snapshot is not canonical.')
  return parsed
}

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, limit) : undefined
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: string[] = []
  for (const item of value) {
    const text = normalizeText(item, SHORT_TEXT_LIMIT)
    const key = text?.toLowerCase()
    if (!text || !key || seen.has(key)) continue
    seen.add(key)
    items.push(text)
    if (items.length >= LIST_LIMIT) break
  }
  return items
}

function normalizeRelationshipKind(value: unknown): TavernRelationshipMemoryKind {
  if (value === 'affinity' || value === 'trust' || value === 'event' || value === 'preference' || value === 'boundary') return value
  return 'event'
}

function normalizeRelationshipMemoryRetentionClass(value: unknown, kind: TavernRelationshipMemoryKind): TavernRelationshipMemoryRetentionClass {
  if (value === 'session' || value === 'long-term' || value === 'boundary') return value
  return kind === 'boundary' ? 'boundary' : 'session'
}

function normalizeRelationshipMemoryReviewStatus(value: unknown): TavernRelationshipMemoryReviewStatus {
  if (value === 'duplicate' || value === 'conflict') return value
  return 'new'
}

function normalizeId(value: unknown): string | undefined {
  const text = normalizeText(value, 120)
  if (!text || /[\u0000-\u001F]/.test(text)) return undefined
  return text
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Number(Math.max(min, Math.min(max, value)).toFixed(3))
    : fallback
}

function generateTavernId(prefix: string, value: string, now: number): string {
  return `tavern-${prefix}-${Math.abs(hashString(`${value}:${now}`)).toString(36)}`
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

export const tavernSnapshotCodec = Object.freeze({
  schema: TAVERN_SNAPSHOT_SCHEMA,
  parse: parseCanonicalTavernSnapshot,
})
