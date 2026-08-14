import type { Conversation } from '@/types/chatContracts'

export interface ConversationStorePersistencePort {
  loadRecords(): Promise<readonly Conversation[]>
  saveRecord(conversation: Conversation): Promise<void>
  replaceRecords(conversations: readonly Conversation[]): Promise<void>
  readActiveSelection(): Promise<string | null>
  writeActiveSelection(conversationId: string | null): Promise<void>
}
