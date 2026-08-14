import type { Conversation, Message } from '@/types/chatContracts'

export interface ConversationWorkflowSkillSaveSuggestion {
  ok: boolean
  skill?: {
    name: string
  }
}

export interface ConversationWorkflowSkillSaveApproval {
  approved: true
  approvedBy: 'chat-message'
  approvedAt: number
  visibleSummary: string
}

export type ConversationWorkflowSkillSavePersistenceResult<TBlockedReason> =
  | {
    ok: true
    status: 'saved' | 'already_saved'
    skill: { name: string }
  }
  | {
    ok: false
    status: 'blocked'
    reason?: TBlockedReason
  }

export type SaveConversationWorkflowSkillFromMessageResult =
  | {
    ok: true
    status: 'saved' | 'already_saved'
    skillName: string
  }
  | {
    ok: false
    status: 'unavailable' | 'blocked'
    reason: string
  }

export interface ConversationWorkflowSkillSaveControllerDependencies<
  TSuggestion extends ConversationWorkflowSkillSaveSuggestion,
  TBlockedReason,
> {
  getConversation(conversationId: string): Pick<Conversation, 'messages'> | undefined
  getSuggestion(message: Message): TSuggestion | undefined
  saveApprovedSuggestion(input: {
    suggestion: TSuggestion
    approval: ConversationWorkflowSkillSaveApproval
  }): Promise<ConversationWorkflowSkillSavePersistenceResult<TBlockedReason>>
  now(): number
  translate(key: string): string
  formatBlockedReason(reason: TBlockedReason | undefined): string
}

export interface ConversationWorkflowSkillSaveController {
  saveFromMessage(
    conversationId: string,
    assistantMessageId: string,
  ): Promise<SaveConversationWorkflowSkillFromMessageResult>
}

/**
 * Presentation-owned workflow-skill save action. Store reads and persistence
 * stay injected so the action always resolves the current message at invocation.
 */
export function createConversationWorkflowSkillSaveController<
  TSuggestion extends ConversationWorkflowSkillSaveSuggestion,
  TBlockedReason,
>(
  dependencies: ConversationWorkflowSkillSaveControllerDependencies<TSuggestion, TBlockedReason>,
): ConversationWorkflowSkillSaveController {
  return {
    async saveFromMessage(conversationId, assistantMessageId) {
      const conversation = dependencies.getConversation(conversationId)
      const assistantMessage = conversation?.messages.find((message) => message.id === assistantMessageId)
      if (!assistantMessage || assistantMessage.role !== 'assistant') {
        return {
          ok: false,
          status: 'unavailable',
          reason: dependencies.translate('chatRunner.workflowSave.messageUnavailable'),
        }
      }

      const suggestion = dependencies.getSuggestion(assistantMessage)
      if (!suggestion?.ok || !suggestion.skill) {
        return {
          ok: false,
          status: 'unavailable',
          reason: dependencies.translate('chatRunner.workflowSave.suggestionUnavailable'),
        }
      }

      const result = await dependencies.saveApprovedSuggestion({
        suggestion,
        approval: {
          approved: true,
          approvedBy: 'chat-message',
          approvedAt: dependencies.now(),
          visibleSummary: `Saved from conversation ${conversationId}.`,
        },
      })
      if (!result.ok) {
        return {
          ok: false,
          status: 'blocked',
          reason: dependencies.formatBlockedReason(result.reason),
        }
      }

      return {
        ok: true,
        status: result.status === 'already_saved' ? 'already_saved' : 'saved',
        skillName: result.skill.name,
      }
    },
  }
}
