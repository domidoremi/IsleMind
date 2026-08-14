import type { ConversationToolCatalogManifest } from '@/modules/integrations'
import type {
  WorkflowRunLimits,
  WorkflowStepToolRequest as ConversationToolRequest,
  SaveWorkflowSkillSuggestionInput,
  SaveWorkflowSkillSuggestionResult,
} from '@/modules/tasks'
import type { Conversation } from '@/types/chatContracts'

import type { ConversationMessageInput } from './conversationMessageController'

export const CONVERSATION_MESSAGE_RUNTIME_UNINITIALIZED_ERROR =
  'conversation_message_runtime_uninitialized'
export const CONVERSATION_MESSAGE_RUNTIME_ALREADY_BOUND_ERROR =
  'conversation_message_runtime_already_bound'
export const CONVERSATION_REPLY_STARTER_UNINITIALIZED_ERROR =
  'conversation_reply_starter_not_bound'
export const CONVERSATION_WORKFLOW_REPLY_STARTER_UNINITIALIZED_ERROR =
  'conversation_workflow_reply_starter_not_bound'
export const CONVERSATION_TOOL_CATALOG_UNINITIALIZED_ERROR =
  'conversation_tool_catalog_not_bound'
export const CONVERSATION_WORKFLOW_SKILL_UNINITIALIZED_ERROR =
  'conversation_workflow_skill_not_bound'

export type ConversationMessageRuntimeDispatch = (
  input: ConversationMessageInput,
) => Promise<void>

export type ConversationReplyRuntimeStart = (conversationId: string) => Promise<void>

export interface ConversationConfirmedWorkflowReplyStartOptions {
  explicitToolRequest: ConversationToolRequest
  limits: Partial<WorkflowRunLimits>
  userConfirmed: true
}

export type ConversationConfirmedWorkflowReplyRuntimeStart = (
  conversation: Conversation,
  content: string,
  options: ConversationConfirmedWorkflowReplyStartOptions,
) => Promise<void>

export interface ConversationMessageRuntime {
  dispatchAfterUserProjection: ConversationMessageRuntimeDispatch
  startAfterHistoryProjection: ConversationReplyRuntimeStart
  startConfirmedWorkflowReply: ConversationConfirmedWorkflowReplyRuntimeStart
  resumePendingModelOperation?: (
    conversationId: string,
    assistantMessageId: string,
    runId: string,
    approved: boolean,
  ) => Promise<boolean>
  listConversationToolManifests(): Promise<ConversationToolCatalogManifest[]>
  resolveConversationTool(
    request: ConversationToolRequest,
    manifests: ConversationToolCatalogManifest[],
  ): ConversationToolCatalogManifest | null
  saveApprovedWorkflowSkillSuggestion(
    input: SaveWorkflowSkillSuggestionInput,
  ): Promise<SaveWorkflowSkillSuggestionResult>
}

let runtime: ConversationMessageRuntime | undefined

/**
 * Installs the composition-root runtime methods atomically. Repeating the same
 * method identities is safe for React development lifecycles; replacing any
 * method is not.
 */
export function bindConversationMessageRuntime(
  nextRuntime: ConversationMessageRuntime,
): void {
  if (!runtime) {
    runtime = {
      dispatchAfterUserProjection: nextRuntime.dispatchAfterUserProjection,
      startAfterHistoryProjection: nextRuntime.startAfterHistoryProjection,
      startConfirmedWorkflowReply: nextRuntime.startConfirmedWorkflowReply,
      resumePendingModelOperation: nextRuntime.resumePendingModelOperation,
      listConversationToolManifests: nextRuntime.listConversationToolManifests,
      resolveConversationTool: nextRuntime.resolveConversationTool,
      saveApprovedWorkflowSkillSuggestion: nextRuntime.saveApprovedWorkflowSkillSuggestion,
    }
    return
  }

  if (!hasSameRuntimeMethods(runtime, nextRuntime)) {
    throw new Error(CONVERSATION_MESSAGE_RUNTIME_ALREADY_BOUND_ERROR)
  }
}

export function releaseConversationMessageRuntime(
  boundRuntime: ConversationMessageRuntime,
): void {
  if (runtime && hasSameRuntimeMethods(runtime, boundRuntime)) runtime = undefined
}

export async function saveApprovedConversationWorkflowSkillRuntime(
  input: SaveWorkflowSkillSuggestionInput,
): Promise<SaveWorkflowSkillSuggestionResult> {
  const save = runtime?.saveApprovedWorkflowSkillSuggestion
  if (!save) throw new Error(CONVERSATION_WORKFLOW_SKILL_UNINITIALIZED_ERROR)
  return save(input)
}

export async function listConversationToolManifestsRuntime(): Promise<ConversationToolCatalogManifest[]> {
  const list = runtime?.listConversationToolManifests
  if (!list) throw new Error(CONVERSATION_TOOL_CATALOG_UNINITIALIZED_ERROR)
  return list()
}

export function resolveConversationToolRuntime(
  request: ConversationToolRequest,
  manifests: ConversationToolCatalogManifest[],
): ConversationToolCatalogManifest | null {
  const resolve = runtime?.resolveConversationTool
  if (!resolve) throw new Error(CONVERSATION_TOOL_CATALOG_UNINITIALIZED_ERROR)
  return resolve(request, manifests)
}

/**
 * Presentation-owned runtime seam. A send before explicit bootstrap
 * composition fails closed rather than relying on import evaluation order.
 */
export async function dispatchConversationMessageRuntime(
  input: ConversationMessageInput,
): Promise<void> {
  const dispatch = runtime?.dispatchAfterUserProjection
  if (!dispatch) {
    throw new Error(CONVERSATION_MESSAGE_RUNTIME_UNINITIALIZED_ERROR)
  }

  await dispatch(input)
}

/**
 * Starts a reply only after presentation has selected the exact conversation
 * history to run. Retry and regenerate await this seam so startup failures are
 * reported without falling back to import-evaluation ordering.
 */
export async function startConversationReplyAfterHistoryProjectionRuntime(
  conversationId: string,
): Promise<void> {
  const start = runtime?.startAfterHistoryProjection
  if (!start) {
    throw new Error(CONVERSATION_REPLY_STARTER_UNINITIALIZED_ERROR)
  }

  await start(conversationId)
}

/**
 * Restarts a confirmed Chat workflow reply after bootstrap has installed the durable
 * runtime implementation. Confirmation owns stop/removal and its final
 * conversation re-read; this seam preserves that exact restart input.
 */
export async function startConfirmedConversationWorkflowReplyRuntime(
  conversation: Conversation,
  content: string,
  options: ConversationConfirmedWorkflowReplyStartOptions,
): Promise<void> {
  const start = runtime?.startConfirmedWorkflowReply
  if (!start) {
    throw new Error(CONVERSATION_WORKFLOW_REPLY_STARTER_UNINITIALIZED_ERROR)
  }

  await start(conversation, content, options)
}

export async function resumePendingConversationModelOperationRuntime(
  conversationId: string,
  assistantMessageId: string,
  runId: string,
  approved: boolean,
): Promise<boolean> {
  const resume = runtime?.resumePendingModelOperation
  if (!resume) return false
  return resume(conversationId, assistantMessageId, runId, approved)
}

function hasSameRuntimeMethods(
  currentRuntime: ConversationMessageRuntime,
  nextRuntime: ConversationMessageRuntime,
): boolean {
  return currentRuntime.dispatchAfterUserProjection === nextRuntime.dispatchAfterUserProjection
    && currentRuntime.startAfterHistoryProjection === nextRuntime.startAfterHistoryProjection
    && currentRuntime.startConfirmedWorkflowReply === nextRuntime.startConfirmedWorkflowReply
    && currentRuntime.resumePendingModelOperation === nextRuntime.resumePendingModelOperation
    && currentRuntime.listConversationToolManifests === nextRuntime.listConversationToolManifests
    && currentRuntime.resolveConversationTool === nextRuntime.resolveConversationTool
    && currentRuntime.saveApprovedWorkflowSkillSuggestion === nextRuntime.saveApprovedWorkflowSkillSuggestion
}
