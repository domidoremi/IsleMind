import type { Conversation } from '@/types/chatContracts'
import type { ConversationPage, ConversationPageInput } from '../contracts'

export interface ConversationStorePersistencePort {
  loadRecords(): Promise<readonly Conversation[]>
  loadPage(input?: ConversationPageInput): Promise<ConversationPage>
  loadRecord(conversationId: string): Promise<Conversation | undefined>
  saveRecord(conversation: Conversation): Promise<void>
  replaceRecords(conversations: readonly Conversation[]): Promise<void>
  readActiveSelection(): Promise<string | null>
  writeActiveSelection(conversationId: string | null): Promise<void>
}
