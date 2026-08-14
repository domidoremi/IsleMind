import type { ConversationToolCatalogManifest } from '@/modules/integrations'
import type {
  ConversationChatWorkflowRuntimeRequestedOutput,
  WorkflowRunLimits,
} from '@/modules/tasks'
import type { Attachment, Conversation } from '@/types/chatContracts'
import type { Settings } from '@/types/settingsContracts'

export interface ConversationReplyDispatchInput {
  conversation: Conversation
  content: string
  attachments?: Attachment[]
  workflowId?: string
  requestedOutput?: ConversationChatWorkflowRuntimeRequestedOutput
}

export interface ConversationReplyWorkflowBlockState {
  workflowId: string
  reason: 'workflow-disabled' | 'workflow-review-required' | 'workflow-invalid'
}

export interface ConversationReplyDecisionContext<
  TManifest extends ConversationToolCatalogManifest = ConversationToolCatalogManifest,
  TBlockedState extends ConversationReplyWorkflowBlockState = ConversationReplyWorkflowBlockState,
> {
  manifests?: TManifest[]
  enabledWorkflowIds?: string[]
  blockedWorkflowStates?: TBlockedState[]
}

export interface ConversationReplyWorkflowStartOptions<
  TManifest extends ConversationToolCatalogManifest,
  TBlockedState extends ConversationReplyWorkflowBlockState,
> {
  workflowId?: string
  requestedOutput?: ConversationChatWorkflowRuntimeRequestedOutput
  manifests?: TManifest[]
  enabledWorkflowIds?: string[]
  blockedWorkflowStates?: TBlockedState[]
  limits: WorkflowRunLimits
}

export interface ConversationReplyDispatchControllerDependencies<
  TManifest extends ConversationToolCatalogManifest,
  TBlockedState extends ConversationReplyWorkflowBlockState,
> {
  normalizeContent(content: string): string
  readSettings(): Settings
  resolveDecisionContext(
    conversation: Conversation,
    settings: Settings,
  ): Promise<ConversationReplyDecisionContext<TManifest, TBlockedState>>
  resolveWorkflowRunLimits(settings: Settings): WorkflowRunLimits
  startWorkflowReply(
    conversation: Conversation,
    content: string,
    options: ConversationReplyWorkflowStartOptions<TManifest, TBlockedState>,
  ): Promise<void>
  startAssistantReply(conversationId: string): Promise<void>
  reportError(message: string): void
  sendFailedFallback(): string
}

export interface ConversationReplyDispatchController {
  dispatch(input: ConversationReplyDispatchInput): Promise<void>
}

/**
 * Routes typed text directly to Assistant Runtime. Only explicit structured
 * workflow/output controls may enter the durable Chat workflow lane.
 */
export function createConversationReplyDispatchController<
  TManifest extends ConversationToolCatalogManifest,
  TBlockedState extends ConversationReplyWorkflowBlockState,
>(
  dependencies: ConversationReplyDispatchControllerDependencies<
    TManifest,
    TBlockedState
  >,
): ConversationReplyDispatchController {
  const reportStartupFailure = (error: unknown): void => {
    const message = error instanceof Error
      ? error.message
      : dependencies.sendFailedFallback()
    dependencies.reportError(message)
  }

  return {
    async dispatch({
      conversation,
      content,
      attachments = [],
      workflowId,
      requestedOutput,
    }) {
      const normalizedContent = dependencies.normalizeContent(content)
      if (!normalizedContent && attachments.length === 0) return

      const normalizedWorkflowId = workflowId?.trim()
      const startsStructuredWorkflow = Boolean(normalizedWorkflowId)
        || requestedOutput === 'work-artifact'
      if (!startsStructuredWorkflow) {
        void dependencies.startAssistantReply(conversation.id).catch((error: unknown) => {
          reportStartupFailure(error)
        })
        return
      }

      const settings = dependencies.readSettings()
      const decisionContext = await dependencies.resolveDecisionContext(
        conversation,
        settings,
      )
      const limits = dependencies.resolveWorkflowRunLimits(settings)
      void dependencies.startWorkflowReply(conversation, normalizedContent, {
        ...(normalizedWorkflowId ? { workflowId: normalizedWorkflowId } : {}),
        requestedOutput,
        manifests: decisionContext.manifests,
        enabledWorkflowIds: decisionContext.enabledWorkflowIds,
        blockedWorkflowStates: decisionContext.blockedWorkflowStates,
        limits,
      }).catch((error: unknown) => {
        reportStartupFailure(error)
      })
    },
  }
}
