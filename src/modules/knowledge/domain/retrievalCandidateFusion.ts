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
  for (const row of ftsRows) {
    const ftsScore = normalizeFtsScore(row.score ?? 0)
    merged.set(row.id, {
      ...row,
      score: ftsScore,
      ftsScore,
      retrievalMode: 'fts',
    })
  }
  for (const row of vectorRows) {
    const existing = merged.get(row.id)
    const vectorScore = row.vectorScore ?? row.score ?? 0
    const ftsScore = existing?.ftsScore ?? 0
    merged.set(row.id, {
      ...(existing ?? row),
      score: mode === 'hybrid' ? vectorScore * 0.62 + ftsScore * 0.38 : vectorScore,
      vectorScore,
      ftsScore: existing?.ftsScore,
      retrievalMode: existing ? 'hybrid' : 'vector',
    })
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

function normalizeFtsScore(score: number): number {
  return 1 / (1 + Math.abs(score))
}

function mergeSourceReason(left?: string, right?: string): string | undefined {
  const reasons = [left, right].filter((item): item is string => !!item)
  return reasons.length ? Array.from(new Set(reasons)).join('+') : undefined
}
