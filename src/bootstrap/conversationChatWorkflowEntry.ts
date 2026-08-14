import {
  createConversationChatWorkflowEntryPolicy,
  type ConversationChatWorkflowEntryDecision as TargetConversationChatWorkflowEntryDecision,
  type ConversationChatWorkflowEntryInput as TargetConversationChatWorkflowEntryInput,
  type ConversationChatWorkflowEntryReason as TargetConversationChatWorkflowEntryReason,
  type ConversationChatWorkflowReply as TargetConversationChatWorkflowReply,
  type WorkflowDefinitionRecord,
  type WorkflowExecutionRun,
  type WorkflowStepToolRequest as AgentToolRequest,
  type WorkflowIntentClassification,
} from '@/modules/tasks'
import type { ConversationToolCatalogManifest as ConversationToolManifest } from '@/modules/integrations'
import type { ConversationRagRuntime } from '@/modules/knowledge'
import { workflowIntentClassifier } from '@/bootstrap/workflowIntent'
import { runWorkflow } from '@/bootstrap/workflowOrchestrator'
import { createWorkflowSkillSuggestionFromRun } from '@/bootstrap/workflowSkills'
import type { WorkflowSkillSuggestion } from '@/modules/tasks'

const conversationChatWorkflowEntryPolicy = createConversationChatWorkflowEntryPolicy<
  AgentToolRequest,
  WorkflowDefinitionRecord,
  ConversationToolManifest,
  ConversationRagRuntime,
  WorkflowIntentClassification,
  WorkflowExecutionRun,
  WorkflowSkillSuggestion
>({
  classifyConversationChatWorkflowIntent: (input) => workflowIntentClassifier.classify(input),
  runConversationChatWorkflow: runWorkflow,
  createWorkflowSkillSuggestionFromRun,
})

export type ConversationChatWorkflowEntryInput = TargetConversationChatWorkflowEntryInput<
  AgentToolRequest,
  WorkflowDefinitionRecord,
  ConversationToolManifest,
  ConversationRagRuntime
>

export type ConversationChatWorkflowEntryDecision =
  TargetConversationChatWorkflowEntryDecision<WorkflowIntentClassification>

export type ConversationChatWorkflowReply = TargetConversationChatWorkflowReply<WorkflowExecutionRun>
export type ConversationChatWorkflowEntryReason = TargetConversationChatWorkflowEntryReason

export const decideConversationChatWorkflowEntry =
  conversationChatWorkflowEntryPolicy.decideConversationChatWorkflowEntry

export const runConversationChatWorkflow =
  conversationChatWorkflowEntryPolicy.runConversationChatWorkflow

export const formatConversationChatWorkflowReply =
  conversationChatWorkflowEntryPolicy.formatConversationChatWorkflowReply
