export type KnowledgeCandidateRetrievalMode = 'fts' | 'vector' | 'hybrid'

export interface KnowledgeFusionCandidate {
  id: string
  chunkId?: string
  score?: number
  ftsScore?: number
  vectorScore?: number
  retrievalMode?: KnowledgeCandidateRetrievalMode
  sourceReason?: string
}

export function fuseHybridKnowledgeCandidates<Source extends KnowledgeFusionCandidate>(
  ftsRows: readonly Source[],
  vectorRows: readonly Source[],
  mode: Extract<KnowledgeCandidateRetrievalMode, 'fts' | 'hybrid'>,
): Source[] {
  const merged = new Map<string, Source>()
  const maxFtsMagnitude = ftsRows.reduce((max, row) => {
    const raw = row.ftsScore ?? row.score ?? 0
    return Number.isFinite(raw) ? Math.max(max, -raw) : max
  }, 0)
  for (const row of ftsRows) {
    const ftsScore = row.ftsScore ?? row.score ?? 0
    const relevance = Number.isFinite(ftsScore) && maxFtsMagnitude > 0
      ? Math.max(0, -ftsScore) / maxFtsMagnitude
      : 0
    merged.set(row.id, {
      ...row,
      score: relevance,
      ftsScore,
      retrievalMode: 'fts',
    })
  }
  for (const row of vectorRows) {
    const existing = merged.get(row.id)
    const vectorScore = row.vectorScore ?? row.score ?? 0
    const ftsRelevance = existing?.score ?? 0
    merged.set(row.id, {
      ...(existing ?? row),
      score: mode === 'hybrid' ? vectorScore * 0.62 + ftsRelevance * 0.38 : vectorScore,
      vectorScore,
      ftsScore: existing?.ftsScore,
      retrievalMode: existing ? 'hybrid' : 'vector',
    })
  }
  // With both channels in play, absent vector evidence contributes zero; it
  // must not give FTS-only hits more weight than equally lexical hybrid hits.
  // Keep the existing FTS fallback scale when no vector candidates exist.
  if (mode === 'hybrid' && vectorRows.length > 0) {
    for (const row of merged.values()) {
      if (row.retrievalMode === 'fts') row.score = (row.score ?? 0) * 0.38
    }
  }
  return Array.from(merged.values())
}

export function mergeAgenticKnowledgeCandidates<Source extends KnowledgeFusionCandidate>(
  batches: readonly (readonly Source[])[],
): Source[] {
  const merged = new Map<string, Source>()
  for (const source of batches.flat()) {
    const key = source.chunkId ?? source.id
    const existing = merged.get(key)
    if (!existing || (source.score ?? 0) > (existing.score ?? 0)) {
      merged.set(key, existing
        ? { ...source, sourceReason: mergeSourceReason(existing.sourceReason, source.sourceReason) }
        : source)
    }
  }
  return Array.from(merged.values())
}

function mergeSourceReason(left?: string, right?: string): string | undefined {
  const reasons = [left, right].filter((item): item is string => !!item)
  return reasons.length ? Array.from(new Set(reasons)).join('+') : undefined
}
