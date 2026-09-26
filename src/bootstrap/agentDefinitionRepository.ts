import { createSqliteAgentDefinitionRepository } from '@/modules/assistant-runtime'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'

export const agentDefinitionRepository = createSqliteAgentDefinitionRepository(createExpoSqliteDatabaseProvider())
