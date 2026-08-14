import type { AssistantRunId } from '@/core'

export const ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA =
  'islemind.assistant-conversation-workspace-writeback-policy.v1' as const
export const ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA =
  'islemind.assistant-conversation-workspace-writeback-handoff.v1' as const

export interface AssistantConversationWorkspaceWritebackPolicy {
  readonly schema: typeof ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA
  readonly summary: 'commit'
  readonly characterUpdates: 'review'
  readonly lorebookUpdates: 'review'
  readonly relationshipMemoryUpdates: 'review'
  readonly sceneUpdates: 'review'
}

export interface AssistantConversationWorkspaceWritebackHandoff {
  readonly schema: typeof ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA
  readonly assistantRunId: AssistantRunId
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly workspaceId: string
  readonly repositoryAuthorityRevision: number
  readonly latestUserInput: string
  readonly selectedSceneId?: string
  readonly orderedCharacterIds: readonly string[]
  readonly policy: AssistantConversationWorkspaceWritebackPolicy
  readonly occurredAt: number
  readonly idempotencyKey: string
}
