import { createSqliteAgentDefinitionRepository } from '@/modules/assistant-runtime/adapters/sqliteAgentDefinitionRepository'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'

export const agentDefinitionRepository = createSqliteAgentDefinitionRepository(createExpoSqliteDatabaseProvider())
