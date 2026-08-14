import { createSqliteConversationRepository } from '@/modules/conversations'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'

export const conversationPersistence = createSqliteConversationRepository(createExpoSqliteDatabaseProvider())
