import { extractTavernCharacterVoiceSampleLines } from './tavernInterchangePolicy'
import {
  deleteTavernItem,
  normalizeTavernSnapshot,
  upsertTavernCharacter,
  upsertTavernLorebookEntry,
  upsertTavernNarrativeSummary,
  upsertTavernPendingWriteback,
  upsertTavernRelationshipMemory,
  upsertTavernScene,
} from './tavernSnapshotPolicy'
import type {
  TavernCharacterCard,
  TavernCharacterDraftProposal,
  TavernCharacterStabilityAnchor,
  TavernCharacterStabilityDiagnostic,
  TavernLorebookDraftProposal,
  TavernLorebookEntry,
  TavernPendingWriteback,
  TavernRelationshipMemory,
  TavernRelationshipMemoryCandidate,
  TavernRelationshipMemoryKind,
  TavernRelationshipStateReport,
  TavernScene,
  TavernSceneChangeProposal,
  TavernSnapshot,
} from './tavernContracts'

export interface TavernShapingReviewReasonSource {
  reason?: string
}

export interface TavernShapingReviewMemoryCandidate extends TavernShapingReviewReasonSource {
  reviewStatus?: string
}

export interface TavernShapingReviewUnits {
  characterDraftProposal?: TavernShapingReviewReasonSource
  lorebookDraftProposal?: TavernShapingReviewReasonSource
  relationshipMemoryCandidates: readonly TavernShapingReviewMemoryCandidate[]
  sceneChangeProposal?: TavernShapingReviewReasonSource
}

export interface TavernShapingReviewBreakdown {
  characters: number
  lore: number
  memories: number
  scenes: number
  total: number
}

export interface TavernSceneChangeUnresolvedRefs {
  unresolvedSceneRef?: string
  unresolvedBranchFromSceneRef?: string
  unresolvedCharacterRefs?: readonly string[]
  unresolvedSpeakingOrderRefs?: readonly string[]
}

const TAVERN_CHARACTER_STABILITY_ANCHORS: TavernCharacterStabilityAnchor[] = [
  'persona',
  'voice',
  'emotionalTone',
  'phrasing',
  'boundaries',
  'opening',
]

const TAVERN_RELATIONSHIP_MEMORY_KIND_ORDER: TavernRelationshipMemoryKind[] = [
  'boundary',
  'preference',
  'trust',
  'affinity',
  'event',
]

export function buildTavernCharacterStabilityDiagnostic(
  character: TavernCharacterCard,
): TavernCharacterStabilityDiagnostic {
  const presentAnchors: TavernCharacterStabilityAnchor[] = [
    character.persona ? 'persona' : undefined,
    character.speechStyle ? 'voice' : undefined,
    hasTavernCharacterEmotionalToneAnchor(character) ? 'emotionalTone' : undefined,
    hasTavernCharacterPhrasingAnchor(character) ? 'phrasing' : undefined,
    character.constraints.length ? 'boundaries' : undefined,
    character.openingMessage ? 'opening' : undefined,
  ].filter((anchor): anchor is TavernCharacterStabilityAnchor => Boolean(anchor))
  const missingAnchors = TAVERN_CHARACTER_STABILITY_ANCHORS
    .filter((anchor) => !presentAnchors.includes(anchor))
  return {
    characterId: character.id,
    name: character.name,
    presentAnchors,
    missingAnchors,
    score: roundTavernReviewScore(presentAnchors.length / TAVERN_CHARACTER_STABILITY_ANCHORS.length),
  }
}

export function buildTavernRelationshipStateReport(
  snapshot: TavernSnapshot,
): TavernRelationshipStateReport {
  const normalized = normalizeTavernSnapshot(snapshot)
  const confirmedByCharacter = new Map<string, TavernRelationshipMemory[]>()
  const pendingByCharacter = new Map<string, TavernRelationshipMemoryCandidate[]>()
  let pendingMemoryCount = 0
  let pendingPrivateMemoryCount = 0
  for (const memory of normalized.relationshipMemories) {
    confirmedByCharacter.set(memory.characterId, [...(confirmedByCharacter.get(memory.characterId) ?? []), memory])
  }
  for (const pending of normalized.pendingWritebacks) {
    for (const candidate of pending.relationshipMemoryCandidates) {
      pendingMemoryCount += 1
      if (!candidate.suggestedUserVisible) pendingPrivateMemoryCount += 1
      if (!candidate.characterId) continue
      pendingByCharacter.set(candidate.characterId, [...(pendingByCharacter.get(candidate.characterId) ?? []), candidate])
    }
  }
  const diagnostics = normalized.characters.map((character) => {
    const confirmed = confirmedByCharacter.get(character.id) ?? []
    const pending = pendingByCharacter.get(character.id) ?? []
    return {
      characterId: character.id,
      name: character.name,
      confirmedMemoryCount: confirmed.length,
      visibleMemoryCount: confirmed.filter((memory) => memory.userVisible).length,
      privateMemoryCount: confirmed.filter((memory) => !memory.userVisible).length,
      pendingMemoryCount: pending.length,
      pendingPrivateMemoryCount: pending.filter((candidate) => !candidate.suggestedUserVisible).length,
      memoryKinds: uniqueTavernRelationshipMemoryKinds([
        ...confirmed.map((memory) => memory.kind),
        ...pending.map((candidate) => candidate.kind),
      ]),
    }
  })
  return {
    characterCount: diagnostics.length,
    relatedCharacterCount: diagnostics.filter((diagnostic) => diagnostic.confirmedMemoryCount + diagnostic.pendingMemoryCount > 0).length,
    pendingCharacterCount: diagnostics.filter((diagnostic) => diagnostic.pendingMemoryCount > 0).length,
    confirmedMemoryCount: normalized.relationshipMemories.length,
    pendingMemoryCount,
    privateMemoryCount: normalized.relationshipMemories.filter((memory) => !memory.userVisible).length,
    pendingPrivateMemoryCount,
    diagnostics,
  }
}

export function clearTavernPrivateRelationshipMemory(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const relationshipMemories = normalized.relationshipMemories.filter((memory) => memory.userVisible)
  const hiddenRelationshipMemoryEvidence = new Set(
    normalized.relationshipMemories
      .filter((memory) => !memory.userVisible)
      .map((memory) => `memory:${memory.id}`),
  )
  let pendingCandidateRemoved = false
  const pendingWritebacks = normalized.pendingWritebacks
    .map((pending) => {
      const hiddenCandidateEvidence = new Set(
        pending.relationshipMemoryCandidates
          .filter((candidate) => !candidate.suggestedUserVisible)
          .map((candidate) => `memory-candidate:${candidate.id}`),
      )
      const relationshipMemoryCandidates = pending.relationshipMemoryCandidates
        .filter((candidate) => candidate.suggestedUserVisible)
      if (relationshipMemoryCandidates.length !== pending.relationshipMemoryCandidates.length) {
        pendingCandidateRemoved = true
      }
      const evidence = pending.evidence.filter(
        (item) => !hiddenRelationshipMemoryEvidence.has(item) && !hiddenCandidateEvidence.has(item),
      )
      return relationshipMemoryCandidates.length === pending.relationshipMemoryCandidates.length &&
        evidence.length === pending.evidence.length
        ? pending
        : { ...pending, relationshipMemoryCandidates, evidence, updatedAt: now }
    })
    .filter(hasTavernPendingWritebackReviewUnits)
  if (relationshipMemories.length === normalized.relationshipMemories.length && !pendingCandidateRemoved) {
    return normalized
  }
  return normalizeTavernSnapshot({
    ...normalized,
    relationshipMemories,
    pendingWritebacks,
    updatedAt: now,
  }, now)
}

export function dismissTavernPendingWriteback(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  return deleteTavernItem(snapshot, 'pendingWritebacks', pendingWritebackId, now)
}

export function dismissAllTavernPendingWritebacks(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  if (!normalized.pendingWritebacks.length) return normalized
  return normalizeTavernSnapshot({ ...normalized, pendingWritebacks: [], updatedAt: now }, now)
}

export function approveTavernPendingWriteback(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending) return normalized

  let next = pending.summaryDraft
    ? approveTavernPendingSummaryDraft(normalized, pending.id, now)
    : normalized
  next = pending.characterDraftProposal
    ? approveTavernPendingCharacterDraft(next, pending.id, now)
    : next
  next = pending.lorebookDraftProposal
    ? approveTavernPendingLorebookDraft(next, pending.id, now)
    : next
  next = pending.relationshipMemoryCandidates.length
    ? approveTavernPendingNewRelationshipMemories(next, pending.id, now)
    : next
  next = pending.sceneChangeProposal
    ? approveTavernPendingSceneChange(next, pending.id, now)
    : next
  return next
}

export function approveAllTavernPendingWritebacks(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  let next = approveAllTavernPendingSummaryDrafts(snapshot, now)
  next = approveAllTavernPendingCharacterDrafts(next, now)
  next = approveAllTavernPendingLorebookDrafts(next, now)
  next = approveAllTavernPendingNewRelationshipMemories(next, now)
  next = approveAllTavernPendingSceneChanges(next, now)
  return next
}

export interface TavernCharacterDraftApplicationResult {
  snapshot: TavernSnapshot
  applied: boolean
  reason?: 'ambiguous_target'
}

export function applyTavernCharacterDraftProposal(
  snapshot: TavernSnapshot,
  proposal: TavernCharacterDraftProposal,
  now = Date.now(),
): TavernCharacterDraftApplicationResult {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const targetDecision = resolveTavernCharacterDraftTargetDecision(
    proposal,
    normalized.characters,
  )
  if (targetDecision.ambiguous) {
    return { snapshot: normalized, applied: false, reason: 'ambiguous_target' }
  }
  return {
    snapshot: upsertTavernCharacter(
      normalized,
      buildTavernCharacterFromDraftProposal(proposal, targetDecision.target),
      now,
    ),
    applied: true,
  }
}

export function approveTavernPendingCharacterDraft(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending?.characterDraftProposal) return normalized
  const application = applyTavernCharacterDraftProposal(
    normalized,
    pending.characterDraftProposal,
    now,
  )
  if (!application.applied) return application.snapshot
  const evidence = pending.evidence.filter(
    (item) => item !== `character-draft-candidate:${pending.characterDraftProposal?.id}`,
  )
  const nextPending = { ...pending, characterDraftProposal: undefined, evidence }
  return hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(
      application.snapshot,
      { ...nextPending, updatedAt: now },
      now,
    )
    : deleteTavernItem(application.snapshot, 'pendingWritebacks', pending.id, now)
}

export function dismissTavernPendingCharacterDraft(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending?.characterDraftProposal) return normalized
  const evidence = pending.evidence.filter(
    (item) => item !== `character-draft-candidate:${pending.characterDraftProposal?.id}`,
  )
  const nextPending = { ...pending, characterDraftProposal: undefined, evidence }
  return hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(
      normalized,
      { ...nextPending, updatedAt: now },
      now,
    )
    : deleteTavernItem(normalized, 'pendingWritebacks', pending.id, now)
}

export function approveAllTavernPendingCharacterDrafts(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return orderTavernPendingWritebacksForBulkReview(normalized.pendingWritebacks).reduce(
    (next, pending) => approveTavernPendingCharacterDraft(next, pending.id, now),
    normalized,
  )
}

export function dismissAllTavernPendingCharacterDrafts(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return orderTavernPendingWritebacksForBulkReview(normalized.pendingWritebacks).reduce(
    (next, pending) => dismissTavernPendingCharacterDraft(next, pending.id, now),
    normalized,
  )
}

export interface TavernLorebookDraftApplicationResult {
  snapshot: TavernSnapshot
  applied: boolean
  reason?: 'ambiguous_target'
}

export function applyTavernLorebookDraftProposal(
  snapshot: TavernSnapshot,
  proposal: TavernLorebookDraftProposal,
  now = Date.now(),
): TavernLorebookDraftApplicationResult {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const targetDecision = resolveTavernLorebookDraftTargetDecision(
    proposal,
    normalized.lorebook,
  )
  if (targetDecision.ambiguous) {
    return { snapshot: normalized, applied: false, reason: 'ambiguous_target' }
  }
  return {
    snapshot: upsertTavernLorebookEntry(
      normalized,
      buildTavernLorebookEntryFromDraftProposal(proposal, targetDecision.target),
      now,
    ),
    applied: true,
  }
}

export function approveTavernPendingLorebookDraft(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending?.lorebookDraftProposal) return normalized
  const lorebookDraftProposal = restoreTavernLorebookDraftEnabledFromEvidence(
    pending.lorebookDraftProposal,
    pending.evidence,
  )
  const application = applyTavernLorebookDraftProposal(
    normalized,
    lorebookDraftProposal,
    now,
  )
  if (!application.applied) return application.snapshot
  const removedEvidence = tavernLorebookDraftReviewEvidenceIds(lorebookDraftProposal.id)
  const evidence = pending.evidence.filter((item) => !removedEvidence.has(item))
  const nextPending = { ...pending, lorebookDraftProposal: undefined, evidence }
  return hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(
      application.snapshot,
      { ...nextPending, updatedAt: now },
      now,
    )
    : deleteTavernItem(application.snapshot, 'pendingWritebacks', pending.id, now)
}

export function dismissTavernPendingLorebookDraft(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending?.lorebookDraftProposal) return normalized
  const removedEvidence = tavernLorebookDraftReviewEvidenceIds(pending.lorebookDraftProposal.id)
  const evidence = pending.evidence.filter((item) => !removedEvidence.has(item))
  const nextPending = { ...pending, lorebookDraftProposal: undefined, evidence }
  return hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(
      normalized,
      { ...nextPending, updatedAt: now },
      now,
    )
    : deleteTavernItem(normalized, 'pendingWritebacks', pending.id, now)
}

export function approveAllTavernPendingLorebookDrafts(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return orderTavernPendingWritebacksForBulkReview(normalized.pendingWritebacks).reduce(
    (next, pending) => approveTavernPendingLorebookDraft(next, pending.id, now),
    normalized,
  )
}

export function dismissAllTavernPendingLorebookDrafts(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return orderTavernPendingWritebacksForBulkReview(normalized.pendingWritebacks).reduce(
    (next, pending) => dismissTavernPendingLorebookDraft(next, pending.id, now),
    normalized,
  )
}

export function approveTavernPendingSummaryDraft(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending?.summaryDraft?.summary.trim()) return normalized

  const summaryDraft = pending.summaryDraft
  const evidence = pending.evidence.filter((item) => item !== `summary-draft:${summaryDraft.id}`)
  const sceneId = normalized.scenes.some((scene) => scene.id === summaryDraft.sceneId)
    ? summaryDraft.sceneId
    : undefined
  const next = upsertTavernNarrativeSummary(normalized, {
    id: summaryDraft.id,
    sceneId,
    chapterTitle: summaryDraft.chapterTitle,
    summary: summaryDraft.summary,
    unresolvedThreads: summaryDraft.unresolvedThreads,
    promises: summaryDraft.promises,
    importantChanges: summaryDraft.importantChanges,
  }, now)
  const nextPending = { ...pending, summaryDraft: undefined, evidence }
  return hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(next, { ...nextPending, updatedAt: now }, now)
    : deleteTavernItem(next, 'pendingWritebacks', pending.id, now)
}

export function dismissTavernPendingSummaryDraft(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending?.summaryDraft) return normalized

  const evidence = pending.evidence.filter(
    (item) => item !== `summary-draft:${pending.summaryDraft?.id}`,
  )
  const nextPending = { ...pending, summaryDraft: undefined, evidence }
  return hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(normalized, { ...nextPending, updatedAt: now }, now)
    : deleteTavernItem(normalized, 'pendingWritebacks', pending.id, now)
}

export function approveAllTavernPendingSummaryDrafts(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return normalized.pendingWritebacks.reduce(
    (next, pending) => approveTavernPendingSummaryDraft(next, pending.id, now),
    normalized,
  )
}

export function dismissAllTavernPendingSummaryDrafts(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return normalized.pendingWritebacks.reduce(
    (next, pending) => dismissTavernPendingSummaryDraft(next, pending.id, now),
    normalized,
  )
}

export function approveTavernPendingRelationshipMemory(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  candidateId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  const candidate = pending?.relationshipMemoryCandidates.find((item) => item.id === candidateId)
  if (!pending || !candidate || candidate.reviewStatus !== 'new') return normalized

  const resolvedCandidate = resolveTavernRelationshipMemoryCandidateForApproval(
    normalized,
    candidate,
  )
  if (!resolvedCandidate.characterId) {
    return upsertTavernPendingWriteback(normalized, {
      ...pending,
      relationshipMemoryCandidates: pending.relationshipMemoryCandidates.map((item) =>
        item.id === candidateId ? resolvedCandidate : item
      ),
      updatedAt: now,
    }, now)
  }

  let next = upsertTavernRelationshipMemory(normalized, {
    id: resolvedCandidate.id,
    characterId: resolvedCandidate.characterId,
    kind: resolvedCandidate.kind,
    content: resolvedCandidate.content,
    weight: 0.6,
    userVisible: resolvedCandidate.suggestedUserVisible,
  }, now)
  const remaining = pending.relationshipMemoryCandidates.filter((item) => item.id !== candidateId)
  const evidence = pending.evidence.filter((item) => item !== `memory-candidate:${candidate.id}`)
  const nextPending = { ...pending, relationshipMemoryCandidates: remaining, evidence }
  next = hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(next, { ...nextPending, updatedAt: now }, now)
    : deleteTavernItem(next, 'pendingWritebacks', pending.id, now)
  return next
}

export function replaceTavernPendingRelationshipMemory(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  candidateId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  const candidate = pending?.relationshipMemoryCandidates.find((item) => item.id === candidateId)
  const relatedMemory = candidate?.relatedMemoryId
    ? normalized.relationshipMemories.find((memory) => memory.id === candidate.relatedMemoryId)
    : undefined
  if (!pending || !candidate || !relatedMemory) return normalized

  const resolvedCandidate = resolveTavernRelationshipMemoryCandidateForApproval(
    normalized,
    candidate,
  )
  if (!resolvedCandidate.characterId) {
    return upsertTavernPendingWriteback(normalized, {
      ...pending,
      relationshipMemoryCandidates: pending.relationshipMemoryCandidates.map((item) =>
        item.id === candidateId ? resolvedCandidate : item
      ),
      updatedAt: now,
    }, now)
  }

  let next = upsertTavernRelationshipMemory(normalized, {
    id: relatedMemory.id,
    characterId: resolvedCandidate.characterId,
    kind: resolvedCandidate.kind,
    content: resolvedCandidate.content,
    weight: Math.max(relatedMemory.weight, 0.6),
    userVisible: resolvedCandidate.suggestedUserVisible,
    createdAt: relatedMemory.createdAt,
  }, now)
  const remaining = pending.relationshipMemoryCandidates.filter((item) => item.id !== candidateId)
  const evidence = pending.evidence.filter((item) => item !== `memory-candidate:${candidate.id}`)
  const nextPending = { ...pending, relationshipMemoryCandidates: remaining, evidence }
  next = hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(next, { ...nextPending, updatedAt: now }, now)
    : deleteTavernItem(next, 'pendingWritebacks', pending.id, now)
  return next
}

export function resolveTavernRelationshipMemoryCandidateForApproval(
  snapshot: TavernSnapshot,
  candidate: TavernRelationshipMemoryCandidate,
): TavernRelationshipMemoryCandidate {
  const characterResolution = resolveTavernSceneCharacterRefResolution(
    [candidate.unresolvedCharacterRef, candidate.characterId]
      .filter(isTavernSceneReviewString)
      .join(', '),
    snapshot.characters,
  )
  const characterId = characterResolution.resolved[0]
  const unresolvedCharacterRef = characterId
    ? undefined
    : characterResolution.unresolved[0] ?? candidate.unresolvedCharacterRef
  return {
    ...candidate,
    characterId,
    unresolvedCharacterRef,
  }
}

export function approveTavernPendingRelationshipMemories(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending) return normalized
  return pending.relationshipMemoryCandidates.reduce(
    (next, candidate) => approveTavernPendingRelationshipMemory(
      next,
      pendingWritebackId,
      candidate.id,
      now,
    ),
    normalized,
  )
}

export function approveTavernPendingNewRelationshipMemories(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending) return normalized
  return pending.relationshipMemoryCandidates
    .filter((candidate) => candidate.reviewStatus === 'new')
    .reduce(
      (next, candidate) => approveTavernPendingRelationshipMemory(
        next,
        pendingWritebackId,
        candidate.id,
        now,
      ),
      normalized,
    )
}

export function dismissTavernPendingRelationshipMemory(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  candidateId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  const candidate = pending?.relationshipMemoryCandidates.find((item) => item.id === candidateId)
  if (!pending || !candidate) return normalized
  const remaining = pending.relationshipMemoryCandidates.filter((item) => item.id !== candidateId)
  const evidence = pending.evidence.filter((item) => item !== `memory-candidate:${candidate.id}`)
  const nextPending = { ...pending, relationshipMemoryCandidates: remaining, evidence }
  return hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(normalized, { ...nextPending, updatedAt: now }, now)
    : deleteTavernItem(normalized, 'pendingWritebacks', pending.id, now)
}

export function dismissTavernPendingRelationshipMemories(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending || !pending.relationshipMemoryCandidates.length) return normalized
  const removedCandidateEvidence = new Set(
    pending.relationshipMemoryCandidates.map((candidate) => `memory-candidate:${candidate.id}`),
  )
  const evidence = pending.evidence.filter((item) => !removedCandidateEvidence.has(item))
  const nextPending = { ...pending, relationshipMemoryCandidates: [], evidence }
  return hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(normalized, { ...nextPending, updatedAt: now }, now)
    : deleteTavernItem(normalized, 'pendingWritebacks', pending.id, now)
}

export function approveAllTavernPendingRelationshipMemories(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return normalized.pendingWritebacks.reduce(
    (next, pending) => approveTavernPendingRelationshipMemories(next, pending.id, now),
    normalized,
  )
}

export function approveAllTavernPendingNewRelationshipMemories(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return normalized.pendingWritebacks.reduce(
    (next, pending) => approveTavernPendingNewRelationshipMemories(next, pending.id, now),
    normalized,
  )
}

export function dismissAllTavernPendingRelationshipMemories(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return normalized.pendingWritebacks.reduce(
    (next, pending) => dismissTavernPendingRelationshipMemories(next, pending.id, now),
    normalized,
  )
}

export function approveTavernPendingSceneChange(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  const pendingSceneChangeProposal = pending?.sceneChangeProposal
  if (!pending || !pendingSceneChangeProposal) return normalized
  const evidence = pending.evidence.filter(
    (item) => item !== tavernSceneChangeProposalEvidenceId(pendingSceneChangeProposal),
  )
  const sceneChangeProposal = resolveTavernSceneChangeProposalForApproval(
    normalized,
    pendingSceneChangeProposal,
  )
  if (hasUnresolvedTavernSceneRefs(sceneChangeProposal)) {
    return upsertTavernPendingWriteback(
      normalized,
      { ...pending, sceneChangeProposal, updatedAt: now },
      now,
    )
  }
  let next = applyTavernSceneChangeProposal(normalized, sceneChangeProposal, now)
  next = hasTavernPendingWritebackReviewUnits({
    ...pending,
    sceneChangeProposal: undefined,
    evidence,
  })
    ? upsertTavernPendingWriteback(
        next,
        { ...pending, sceneChangeProposal: undefined, evidence, updatedAt: now },
        now,
      )
    : deleteTavernItem(next, 'pendingWritebacks', pending.id, now)
  return next
}

export function approveAllTavernPendingSceneChanges(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const chronologicalPendingWritebacks = [...normalized.pendingWritebacks].sort(
    (left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt,
  )
  return chronologicalPendingWritebacks.reduce(
    (next, pending) => approveTavernPendingSceneChange(next, pending.id, now),
    normalized,
  )
}

export function dismissTavernPendingSceneChange(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  const sceneChangeProposal = pending?.sceneChangeProposal
  if (!pending || !sceneChangeProposal) return normalized
  const evidence = pending.evidence.filter(
    (item) => item !== tavernSceneChangeProposalEvidenceId(sceneChangeProposal),
  )
  return hasTavernPendingWritebackReviewUnits({
    ...pending,
    sceneChangeProposal: undefined,
    evidence,
  })
    ? upsertTavernPendingWriteback(
        normalized,
        { ...pending, sceneChangeProposal: undefined, evidence, updatedAt: now },
        now,
      )
    : deleteTavernItem(normalized, 'pendingWritebacks', pending.id, now)
}

export function dismissAllTavernPendingSceneChanges(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return normalized.pendingWritebacks.reduce(
    (next, pending) => dismissTavernPendingSceneChange(next, pending.id, now),
    normalized,
  )
}

export function tavernSceneChangeProposalEvidenceId(
  proposal: TavernSceneChangeProposal,
): string {
  return `scene-change-candidate:${
    proposal.sceneId ??
    normalizeTavernSceneReviewId(
      proposal.title ??
        proposal.location ??
        proposal.unresolvedSceneRef ??
        proposal.unresolvedBranchFromSceneRef,
    ) ??
    proposal.branchFromSceneId ??
    'new'
  }`
}

export function applyTavernSceneChangeProposal(
  snapshot: TavernSnapshot,
  proposal: TavernSceneChangeProposal,
  now: number,
): TavernSnapshot {
  const existing = !proposal.createNewScene && proposal.sceneId
    ? snapshot.scenes.find((scene) => scene.id === proposal.sceneId)
    : undefined
  const branchSource = proposal.createNewScene && proposal.branchFromSceneId
    ? snapshot.scenes.find((scene) => scene.id === proposal.branchFromSceneId)
    : undefined
  const fallback = existing ?? branchSource
  const branchFromScene = proposal.branchFromSceneId
    ? snapshot.scenes.find((scene) => scene.id === proposal.branchFromSceneId)
    : undefined
  const activeCharacterResolution = resolveTavernSceneCharacterRefs(
    snapshot,
    proposal.activeCharacterIds,
    proposal.unresolvedCharacterRefs,
  )
  const activeCharacterIds = activeCharacterResolution.resolved
  const speakingOrderResolution = resolveTavernSceneCharacterRefs(
    snapshot,
    proposal.speakingOrder,
    proposal.unresolvedSpeakingOrderRefs,
  )
  const speakingOrder = speakingOrderResolution.resolved
  return upsertTavernScene(
    snapshot,
    {
      ...(existing ?? {}),
      id: proposal.createNewScene ? undefined : existing?.id,
      title: proposal.title ?? fallback?.title ?? 'Tavern scene',
      location: proposal.location ?? fallback?.location ?? 'Tavern',
      branchFromSceneId: branchFromScene?.id ?? existing?.branchFromSceneId,
      timeOfDay: proposal.timeOfDay ?? fallback?.timeOfDay,
      mood: proposal.mood ?? fallback?.mood,
      narrativeGoal: proposal.narrativeGoal ?? fallback?.narrativeGoal,
      activeCharacterIds: activeCharacterIds.length
        ? activeCharacterIds
        : fallback?.activeCharacterIds ?? [],
      narratorStyle: proposal.narratorStyle ?? fallback?.narratorStyle,
      speakingOrder: speakingOrder.length
        ? speakingOrder
        : activeCharacterIds.length
          ? activeCharacterIds
          : fallback?.speakingOrder ?? [],
    },
    now,
  )
}

export function resolveTavernSceneChangeProposalForApproval(
  snapshot: TavernSnapshot,
  proposal: TavernSceneChangeProposal,
): TavernSceneChangeProposal {
  const sceneResolution = proposal.createNewScene
    ? { resolved: undefined, unresolved: undefined }
    : resolveTavernSceneRefResolution(
        [proposal.unresolvedSceneRef, proposal.sceneId],
        snapshot.scenes,
      )
  const branchResolution = resolveTavernSceneRefResolution(
    [proposal.unresolvedBranchFromSceneRef, proposal.branchFromSceneId],
    snapshot.scenes,
  )
  const activeCharacterResolution = resolveTavernSceneCharacterRefs(
    snapshot,
    proposal.activeCharacterIds,
    proposal.unresolvedCharacterRefs,
  )
  const speakingOrderResolution = resolveTavernSceneCharacterRefs(
    snapshot,
    proposal.speakingOrder,
    proposal.unresolvedSpeakingOrderRefs,
  )
  return {
    ...proposal,
    sceneId: proposal.createNewScene ? undefined : sceneResolution.resolved,
    unresolvedSceneRef: proposal.createNewScene ? undefined : sceneResolution.unresolved,
    branchFromSceneId: branchResolution.resolved,
    unresolvedBranchFromSceneRef: branchResolution.unresolved,
    activeCharacterIds: activeCharacterResolution.resolved.length
      ? activeCharacterResolution.resolved
      : undefined,
    unresolvedCharacterRefs: activeCharacterResolution.unresolved.length
      ? activeCharacterResolution.unresolved
      : undefined,
    speakingOrder: speakingOrderResolution.resolved.length
      ? speakingOrderResolution.resolved
      : undefined,
    unresolvedSpeakingOrderRefs: speakingOrderResolution.unresolved.length
      ? speakingOrderResolution.unresolved
      : undefined,
  }
}

export function resolveTavernSceneRefResolution(
  value: string | Array<string | undefined> | undefined,
  scenes: TavernScene[],
): { resolved?: string; unresolved?: string } {
  const refs = (Array.isArray(value) ? value : [value])
    .map((item) => normalizeTavernSceneReviewText(item, 180))
    .filter(isTavernSceneReviewString)
  const unresolved: string[] = []
  for (const ref of refs) {
    const normalizedRef = normalizeTavernSceneReviewComparableText(ref)
    const matchedIds = uniqueTavernSceneReviewStrings(
      scenes
        .filter((scene) =>
          [scene.id, scene.title, scene.location]
            .map((candidate) => normalizeTavernSceneReviewComparableText(candidate))
            .some((candidate) => candidate === normalizedRef),
        )
        .map((scene) => scene.id),
    )
    if (matchedIds.length === 1) return { resolved: matchedIds[0] }
    unresolved.push(ref)
  }
  return { unresolved: unresolved[0] }
}

export function hasUnresolvedTavernSceneRefs(
  proposal: TavernSceneChangeProposal,
): boolean {
  return Boolean(
    proposal.unresolvedSceneRef ||
      proposal.unresolvedBranchFromSceneRef ||
      proposal.unresolvedCharacterRefs?.length ||
      proposal.unresolvedSpeakingOrderRefs?.length,
  )
}

export function hasTavernPendingWritebackReviewUnits(
  pending: Pick<
    TavernPendingWriteback,
    | 'summaryDraft'
    | 'characterDraftProposal'
    | 'lorebookDraftProposal'
    | 'relationshipMemoryCandidates'
    | 'sceneChangeProposal'
    | 'evidence'
  >,
): boolean {
  return Boolean(
    pending.summaryDraft ||
    pending.characterDraftProposal ||
    pending.lorebookDraftProposal ||
    pending.relationshipMemoryCandidates.length ||
    pending.sceneChangeProposal,
  )
}

export function resolveTavernExistingLorebookForDraft(
  ref: string | undefined,
  lorebook: TavernLorebookEntry[],
): TavernLorebookEntry | undefined {
  return resolveTavernExistingLorebookForDraftWithDecision(ref, lorebook).target
}

export function buildTavernLorebookDraftReviewEvidence(
  proposal: TavernLorebookDraftProposal,
): string[] {
  return [
    `lore-draft-candidate:${proposal.id}`,
    typeof proposal.enabled === 'boolean'
      ? tavernLorebookDraftEnabledEvidenceId(proposal.id, proposal.enabled)
      : undefined,
  ].filter((item): item is string => Boolean(item))
}

export function isTavernShapingReviewReason(reason?: string): boolean {
  return /(?:shaping|shape|summary|conversation-shaped|review-ready|塑造|塑形|成形|形成|摘要|总结|總結|提案|建议|建議|形作り|形成|要約|提案|候補)/i.test(reason ?? '')
}

export function approveTavernPendingShapingSuggestions(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending) return normalized

  let next = normalized
  if (
    pending.characterDraftProposal &&
    isTavernShapingReviewReason(pending.characterDraftProposal.reason)
  ) {
    next = approveTavernPendingCharacterDraft(next, pending.id, now)
  }
  for (const candidate of pending.relationshipMemoryCandidates) {
    if (
      candidate.reviewStatus === 'new' &&
      isTavernShapingReviewReason(candidate.reason)
    ) {
      next = approveTavernPendingRelationshipMemory(next, pending.id, candidate.id, now)
    }
  }
  if (
    pending.lorebookDraftProposal &&
    isTavernShapingReviewReason(pending.lorebookDraftProposal.reason)
  ) {
    next = approveTavernPendingLorebookDraft(next, pending.id, now)
  }
  if (
    pending.sceneChangeProposal &&
    isTavernShapingReviewReason(pending.sceneChangeProposal.reason)
  ) {
    next = approveTavernPendingSceneChange(next, pending.id, now)
  }
  return next
}

export function approveAllTavernPendingShapingSuggestions(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const chronologicalPendingWritebacks = [...normalized.pendingWritebacks].sort(
    (left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt,
  )
  return chronologicalPendingWritebacks.reduce(
    (next, pending) => approveTavernPendingShapingSuggestions(next, pending.id, now),
    normalized,
  )
}

export function dismissTavernPendingShapingSuggestions(
  snapshot: TavernSnapshot,
  pendingWritebackId: string,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const pending = normalized.pendingWritebacks.find((item) => item.id === pendingWritebackId)
  if (!pending) return normalized

  const removeEvidence = new Set<string>()
  const removeCharacterDraft = Boolean(
    pending.characterDraftProposal &&
    isTavernShapingReviewReason(pending.characterDraftProposal.reason),
  )
  if (removeCharacterDraft) {
    removeEvidence.add(`character-draft-candidate:${pending.characterDraftProposal?.id}`)
  }

  const removedMemoryCandidates = pending.relationshipMemoryCandidates.filter(
    (candidate) => isTavernShapingReviewReason(candidate.reason),
  )
  for (const candidate of removedMemoryCandidates) {
    removeEvidence.add(`memory-candidate:${candidate.id}`)
  }

  const removeLorebookDraft = Boolean(
    pending.lorebookDraftProposal &&
    isTavernShapingReviewReason(pending.lorebookDraftProposal.reason),
  )
  if (removeLorebookDraft && pending.lorebookDraftProposal) {
    for (const evidenceId of tavernLorebookDraftReviewEvidenceIds(pending.lorebookDraftProposal.id)) {
      removeEvidence.add(evidenceId)
    }
  }

  const sceneChangeProposal = pending.sceneChangeProposal
  const removeSceneChange = Boolean(
    sceneChangeProposal && isTavernShapingReviewReason(sceneChangeProposal.reason),
  )
  if (removeSceneChange && sceneChangeProposal) {
    removeEvidence.add(tavernShapingSceneChangeProposalEvidenceId(sceneChangeProposal))
  }

  if (!removeCharacterDraft && !removedMemoryCandidates.length && !removeLorebookDraft && !removeSceneChange) {
    return normalized
  }

  const nextPending = {
    ...pending,
    characterDraftProposal: removeCharacterDraft ? undefined : pending.characterDraftProposal,
    lorebookDraftProposal: removeLorebookDraft ? undefined : pending.lorebookDraftProposal,
    relationshipMemoryCandidates: pending.relationshipMemoryCandidates.filter(
      (candidate) => !isTavernShapingReviewReason(candidate.reason),
    ),
    sceneChangeProposal: removeSceneChange ? undefined : sceneChangeProposal,
    evidence: pending.evidence.filter((item) => !removeEvidence.has(item)),
    updatedAt: now,
  }

  return hasTavernPendingWritebackReviewUnits(nextPending)
    ? upsertTavernPendingWriteback(normalized, nextPending, now)
    : deleteTavernItem(normalized, 'pendingWritebacks', pending.id, now)
}

export function dismissAllTavernPendingShapingSuggestions(
  snapshot: TavernSnapshot,
  now = Date.now(),
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  return normalized.pendingWritebacks.reduce(
    (next, pending) => dismissTavernPendingShapingSuggestions(next, pending.id, now),
    normalized,
  )
}

export function summarizeTavernShapingReviewUnits(
  pending: TavernShapingReviewUnits,
): TavernShapingReviewBreakdown {
  const characters = pending.characterDraftProposal && isTavernShapingReviewReason(pending.characterDraftProposal.reason) ? 1 : 0
  const lore = pending.lorebookDraftProposal && isTavernShapingReviewReason(pending.lorebookDraftProposal.reason) ? 1 : 0
  const memories = pending.relationshipMemoryCandidates.filter((candidate) => isTavernShapingReviewReason(candidate.reason)).length
  const scenes = pending.sceneChangeProposal && isTavernShapingReviewReason(pending.sceneChangeProposal.reason) ? 1 : 0
  return {
    characters,
    lore,
    memories,
    scenes,
    total: characters + lore + memories + scenes,
  }
}

export function summarizeTavernSafeShapingReviewUnits(
  pending: TavernShapingReviewUnits,
): TavernShapingReviewBreakdown {
  const characters = pending.characterDraftProposal && isTavernShapingReviewReason(pending.characterDraftProposal.reason) ? 1 : 0
  const lore = pending.lorebookDraftProposal && isTavernShapingReviewReason(pending.lorebookDraftProposal.reason) ? 1 : 0
  const memories = pending.relationshipMemoryCandidates.filter((candidate) =>
    candidate.reviewStatus === 'new' &&
    isTavernShapingReviewReason(candidate.reason)
  ).length
  const scenes = pending.sceneChangeProposal && isTavernShapingReviewReason(pending.sceneChangeProposal.reason) ? 1 : 0
  return {
    characters,
    lore,
    memories,
    scenes,
    total: characters + lore + memories + scenes,
  }
}

export function countTavernShapingReviewUnits(pending: TavernShapingReviewUnits): number {
  return summarizeTavernShapingReviewUnits(pending).total
}

export function countTavernSafeShapingReviewUnits(pending: TavernShapingReviewUnits): number {
  return summarizeTavernSafeShapingReviewUnits(pending).total
}

export function hasTavernShapingReviewUnits(pending: TavernShapingReviewUnits): boolean {
  return countTavernShapingReviewUnits(pending) > 0
}

export function tavernSceneChangeProposalHasUnresolvedRefs(
  proposal: TavernSceneChangeUnresolvedRefs,
): boolean {
  return Boolean(
    proposal.unresolvedSceneRef ||
    proposal.unresolvedBranchFromSceneRef ||
    proposal.unresolvedCharacterRefs?.length ||
    proposal.unresolvedSpeakingOrderRefs?.length
  )
}

function hasTavernCharacterEmotionalToneAnchor(character: TavernCharacterCard): boolean {
  return /emotional tone|emotionally|emotional range|affect|feeling tone|warm|calm|gentle|steady|reassur|low drama|情绪基调|情绪语气|情绪输出|情感基调|温柔|平静|稳定|安定|安心|感情のトーン|感情表現|穏やか|温か|落ち着|安心/i.test([
    character.persona,
    character.speechStyle,
  ].join('\n'))
}

interface TavernCharacterDraftTargetDecision {
  target?: TavernCharacterCard
  ambiguous: boolean
}

function resolveTavernCharacterDraftTargetDecision(
  proposal: TavernCharacterDraftProposal,
  characters: TavernCharacterCard[],
): TavernCharacterDraftTargetDecision {
  if (proposal.characterId) {
    const idMatch = characters.find((character) => character.id === proposal.characterId)
    if (idMatch) return { target: idMatch, ambiguous: false }
  }
  const nameKey = normalizeTavernCharacterComparableText(proposal.name)
  if (!nameKey) return { ambiguous: false }
  const nameMatches = characters.filter(
    (character) => normalizeTavernCharacterComparableText(character.name) === nameKey,
  )
  if (nameMatches.length > 1) return { ambiguous: true }
  return { target: nameMatches[0], ambiguous: false }
}

function buildTavernCharacterFromDraftProposal(
  proposal: TavernCharacterDraftProposal,
  existing?: TavernCharacterCard,
): Partial<TavernCharacterCard> {
  return {
    id: existing?.id ?? proposal.id,
    name: proposal.name || existing?.name || 'Tavern character',
    avatarUri: existing?.avatarUri,
    persona: proposal.persona ?? existing?.persona ?? '',
    speechStyle: proposal.speechStyle ?? existing?.speechStyle ?? '',
    background: proposal.background ?? existing?.background ?? '',
    openingMessage: proposal.openingMessage ?? existing?.openingMessage,
    constraints: proposal.constraints.length ? proposal.constraints : existing?.constraints ?? [],
    tags: uniqueTavernCharacterStrings([...(existing?.tags ?? []), ...proposal.tags]),
    createdAt: existing?.createdAt,
  }
}

function normalizeTavernCharacterComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/\\|.,;:!?()[\]{}<>+=*&^%$#@~，。！？；：（）【】《》、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueTavernCharacterStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

interface TavernLorebookDraftTargetDecision {
  target?: TavernLorebookEntry
  ambiguous: boolean
}

function resolveTavernLorebookDraftTargetDecision(
  proposal: TavernLorebookDraftProposal,
  lorebook: TavernLorebookEntry[],
): TavernLorebookDraftTargetDecision {
  if (proposal.loreId) {
    const idKey = normalizeTavernLorebookComparableText(proposal.loreId)
    const idMatch = lorebook.find(
      (entry) => normalizeTavernLorebookComparableText(entry.id) === idKey,
    )
    if (idMatch) return { target: idMatch, ambiguous: false }
  }
  const titleKey = normalizeTavernLorebookComparableText(proposal.title)
  const titleMatches = lorebook.filter(
    (entry) => normalizeTavernLorebookComparableText(entry.title) === titleKey,
  )
  if (titleMatches.length > 1) return { ambiguous: true }
  return { target: titleMatches[0], ambiguous: false }
}

function resolveTavernExistingLorebookForDraftWithDecision(
  ref: string | undefined,
  lorebook: TavernLorebookEntry[],
): TavernLorebookDraftTargetDecision {
  if (!ref) return { ambiguous: false }
  const key = normalizeTavernLorebookComparableText(ref)
  const idMatch = lorebook.find(
    (entry) => normalizeTavernLorebookComparableText(entry.id) === key,
  )
  if (idMatch) return { target: idMatch, ambiguous: false }
  const titleMatches = lorebook.filter(
    (entry) => normalizeTavernLorebookComparableText(entry.title) === key,
  )
  if (titleMatches.length > 1) return { ambiguous: true }
  return { target: titleMatches[0], ambiguous: false }
}

function buildTavernLorebookEntryFromDraftProposal(
  proposal: TavernLorebookDraftProposal,
  existing?: TavernLorebookEntry,
): Partial<TavernLorebookEntry> {
  return {
    id: existing?.id ?? proposal.id,
    title: proposal.title || existing?.title || 'Tavern lore',
    content: proposal.content || existing?.content || '',
    keywords: proposal.keywords.length ? proposal.keywords : existing?.keywords ?? [],
    priority: proposal.priority ?? existing?.priority ?? 50,
    enabled: proposal.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt,
  }
}

function restoreTavernLorebookDraftEnabledFromEvidence(
  proposal: TavernLorebookDraftProposal,
  evidence: readonly string[],
): TavernLorebookDraftProposal {
  if (evidence.includes(tavernLorebookDraftEnabledEvidenceId(proposal.id, true))) {
    return { ...proposal, enabled: true }
  }
  if (evidence.includes(tavernLorebookDraftEnabledEvidenceId(proposal.id, false))) {
    return { ...proposal, enabled: false }
  }
  return proposal
}

function tavernLorebookDraftReviewEvidenceIds(proposalId: string): Set<string> {
  return new Set([
    `lore-draft-candidate:${proposalId}`,
    tavernLorebookDraftEnabledEvidenceId(proposalId, true),
    tavernLorebookDraftEnabledEvidenceId(proposalId, false),
  ])
}

function tavernLorebookDraftEnabledEvidenceId(proposalId: string, enabled: boolean): string {
  return `lore-draft-enabled:${proposalId}:${enabled ? 'true' : 'false'}`
}

function tavernShapingSceneChangeProposalEvidenceId(
  proposal: NonNullable<TavernPendingWriteback['sceneChangeProposal']>,
): string {
  const fallbackId = normalizeTavernShapingEvidenceId(
    proposal.title ??
    proposal.location ??
    proposal.unresolvedSceneRef ??
    proposal.unresolvedBranchFromSceneRef,
  )
  return `scene-change-candidate:${proposal.sceneId ?? fallbackId ?? proposal.branchFromSceneId ?? 'new'}`
}

function normalizeTavernShapingEvidenceId(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim().slice(0, 120)
  return text && !/[\u0000-\u001F]/.test(text) ? text : undefined
}

function resolveTavernSceneCharacterRefs(
  snapshot: TavernSnapshot,
  candidateRefs: string[] | undefined,
  unresolvedRefs: string[] | undefined,
): { resolved: string[]; unresolved: string[] } {
  const candidateResolution = resolveTavernSceneCharacterRefResolution(
    candidateRefs?.join(', '),
    snapshot.characters,
  )
  const unresolvedResolution = resolveTavernSceneCharacterRefResolution(
    [...candidateResolution.unresolved, ...(unresolvedRefs ?? [])].join(', '),
    snapshot.characters,
  )
  return {
    resolved: uniqueTavernSceneReviewStrings([
      ...candidateResolution.resolved,
      ...unresolvedResolution.resolved,
    ]),
    unresolved: uniqueTavernSceneReviewStrings(unresolvedResolution.unresolved),
  }
}

function resolveTavernSceneCharacterRefResolution(
  value: string | undefined,
  characters: TavernCharacterCard[],
): { resolved: string[]; unresolved: string[] } {
  if (!value) return { resolved: [], unresolved: [] }
  const byComparableId = new Map<string, string>()
  const byComparableName = new Map<string, string[]>()
  for (const character of characters) {
    byComparableId.set(
      normalizeTavernSceneReviewComparableText(character.id),
      character.id,
    )
    const nameKey = normalizeTavernSceneReviewComparableText(character.name)
    byComparableName.set(nameKey, [...(byComparableName.get(nameKey) ?? []), character.id])
  }
  const resolved: string[] = []
  const unresolved: string[] = []
  for (const item of splitTavernSceneReviewStructuredList(
    value.replace(/(?:->|→|＞|>)/g, ','),
  )) {
    const parenthetical = /\(([^)]+)\)/.exec(item)?.[1]
    const bareName = item.replace(/\s*\([^)]*\)\s*$/, '')
    const candidates = [item, parenthetical, bareName]
      .map((candidate) => normalizeTavernSceneReviewText(candidate, 180))
      .filter(isTavernSceneReviewString)
    let matched: string | undefined
    for (const candidate of candidates) {
      const key = normalizeTavernSceneReviewComparableText(candidate)
      const resolvedById = byComparableId.get(key)
      const nameMatches = byComparableName.get(key) ?? []
      const resolvedCandidate = resolvedById ??
        (nameMatches.length === 1 ? nameMatches[0] : undefined)
      if (resolvedCandidate) {
        matched = resolvedCandidate
        break
      }
    }
    if (matched) {
      resolved.push(matched)
    } else {
      const unresolvedRef = normalizeTavernSceneReviewText(bareName || item, 180)
      if (unresolvedRef) unresolved.push(unresolvedRef)
    }
  }
  return {
    resolved: uniqueTavernSceneReviewStrings(resolved),
    unresolved: uniqueTavernSceneReviewStrings(unresolved),
  }
}

function splitTavernSceneReviewStructuredList(value?: string): string[] {
  if (!value) return []
  return uniqueTavernSceneReviewStrings(
    value
      .split(/[,，、|/；;]/)
      .map((item) => normalizeTavernSceneReviewText(item, 180))
      .filter(isTavernSceneReviewString),
  )
}

function normalizeTavernSceneReviewText(
  value: unknown,
  limit: number,
): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, limit) : undefined
}

function normalizeTavernSceneReviewId(value: unknown): string | undefined {
  const text = normalizeTavernSceneReviewText(value, 120)
  return text && !/[\u0000-\u001F]/.test(text) ? text : undefined
}

function normalizeTavernSceneReviewComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/\\|.,;:!?()[\]{}<>+=*&^%$#@~，。！？；：（）【】《》、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueTavernSceneReviewStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function isTavernSceneReviewString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function orderTavernPendingWritebacksForBulkReview(
  pendingWritebacks: TavernPendingWriteback[],
): TavernPendingWriteback[] {
  return pendingWritebacks
    .map((pending, index) => ({ pending, index }))
    .sort((left, right) =>
      left.pending.createdAt - right.pending.createdAt ||
      left.pending.updatedAt - right.pending.updatedAt ||
      right.index - left.index
    )
    .map(({ pending }) => pending)
}

function normalizeTavernLorebookComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/\\|.,;:!?()[\]{}<>+=*&^%$#@~，。！？；：（）【】《》、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasTavernCharacterPhrasingAnchor(character: TavernCharacterCard): boolean {
  if (extractTavernCharacterVoiceSampleLines(character.speechStyle).length) return true
  return /wording|phrasing|phrase|recurring|signature|catchphrase|example line|sample line|voice sample|mes_example|imagery|metaphor|concise|poetic|avoid phrase|措辞|表达|常用|口头禅|例句|示例句|代表台词|意象|简洁|诗意|避免|言葉選び|言い回し|決まり文句|よく使う|セリフ例|台詞例|比喩|簡潔|避け/i.test([
    character.speechStyle,
    character.constraints.join('\n'),
  ].join('\n'))
}

function uniqueTavernRelationshipMemoryKinds(
  values: TavernRelationshipMemoryKind[],
): TavernRelationshipMemoryKind[] {
  const valueSet = new Set(values)
  return TAVERN_RELATIONSHIP_MEMORY_KIND_ORDER.filter((kind) => valueSet.has(kind))
}

function roundTavernReviewScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3))
}
