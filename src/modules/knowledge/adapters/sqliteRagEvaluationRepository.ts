import type { SqliteDatabaseProvider } from '@/platform/storage'
import type { RagEvaluationLog, RagEvaluationResult, RagQueryPlan } from '@/types/contextContracts'
import { hashKnowledgeText } from '../domain/localVectorIndex'

export interface RagEvaluationLogInput {
  query: string
  plan?: RagQueryPlan
  quality?: RagEvaluationResult
  sourceCount: number
  latencyMs?: number
  flareTriggered?: boolean
  fallbackReasons?: string[]
}

export interface RagEvaluationRepository {
  log(input: RagEvaluationLogInput): Promise<void>
  list(limit?: number): Promise<readonly RagEvaluationLog[]>
}

export function createSqliteRagEvaluationRepository(databaseProvider: SqliteDatabaseProvider): RagEvaluationRepository {
  let initialized = false
  const database = async () => {
    const value = await databaseProvider.get()
    if (!initialized) {
      await value.exec(`
        CREATE TABLE IF NOT EXISTS rag_evaluation_logs (
          id TEXT PRIMARY KEY NOT NULL,
          query TEXT NOT NULL,
          planJson TEXT,
          qualityJson TEXT,
          sourceCount INTEGER NOT NULL,
          latencyMs INTEGER,
          createdAt INTEGER NOT NULL
        );
      `)
      initialized = true
    }
    return value
  }
  return {
    async log(input) {
      const now = Date.now()
      const quality = input.quality ? {
        ...input.quality,
        flareTriggered: input.flareTriggered ?? input.quality.flareTriggered,
        fallbackReasons: Array.from(new Set([...(input.quality.fallbackReasons ?? []), ...(input.fallbackReasons ?? [])])),
        latencyMs: input.latencyMs ?? input.quality.latencyMs,
      } : undefined
      await (await database()).run(
        'INSERT OR REPLACE INTO rag_evaluation_logs (id, query, planJson, qualityJson, sourceCount, latencyMs, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [`rag-eval-${now}-${Math.abs(hashKnowledgeText(input.query)).toString(36)}`, input.query.slice(0, 2000), input.plan ? JSON.stringify(input.plan) : null, quality ? JSON.stringify(quality) : null, input.sourceCount, input.latencyMs ?? null, now],
      )
    },
    async list(limit = 12) {
      const rows = await (await database()).getAll<{ id: string; query: string; planJson: string | null; qualityJson: string | null; sourceCount: number; latencyMs: number | null; createdAt: number }>(
        'SELECT id, query, planJson, qualityJson, sourceCount, latencyMs, createdAt FROM rag_evaluation_logs ORDER BY createdAt DESC LIMIT ?',
        [Math.max(1, Math.min(limit, 100))],
      )
      return rows.map((row) => ({
        id: row.id,
        query: row.query,
        plan: parseJsonObject<RagQueryPlan>(row.planJson),
        quality: parseJsonObject<RagEvaluationResult>(row.qualityJson),
        sourceCount: row.sourceCount,
        latencyMs: row.latencyMs ?? undefined,
        createdAt: row.createdAt,
      }))
    },
  }
}

function parseJsonObject<Value>(raw: string | null): Value | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Value : undefined
  } catch {
    return undefined
  }
}
