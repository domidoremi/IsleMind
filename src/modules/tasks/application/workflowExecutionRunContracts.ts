import type { AssistantRunId, ProcessTrace } from '@/core'
import type { ConversationChatWorkflowEntryIntent } from './conversationChatWorkflowEntryPolicy'
import type { WorkflowMessagePendingAction } from './workflowMessageActionPolicy'
import type {
  WorkflowRuntimeFailureCode,
  WorkflowRuntimeStatus,
} from './workflowRuntimePolicy'
import type { WorkflowStep } from './workflowStepExecutor'

export interface WorkflowExecutionRuntimeLogOptions {
  enabled?: boolean
  maxBytes?: number
}

export interface WorkflowExecutionRun {
  id: string
  assistantRunId?: AssistantRunId
  goal: string
  intent?: ConversationChatWorkflowEntryIntent
  status: WorkflowRuntimeStatus
  steps: WorkflowStep[]
  traces: ProcessTrace[]
  startedAt: number
  completedAt?: number
  failureCode?: WorkflowRuntimeFailureCode
  finalOutput?: string
  pendingAction?: WorkflowMessagePendingAction
}
