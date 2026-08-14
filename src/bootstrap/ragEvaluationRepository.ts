import { createSqliteRagEvaluationRepository } from '@/modules/knowledge'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'

export const ragEvaluationRepository = createSqliteRagEvaluationRepository(createExpoSqliteDatabaseProvider())
