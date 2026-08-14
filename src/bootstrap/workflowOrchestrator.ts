import {
  projectProcessTrace,
  redactSensitiveText,
  systemClock,
} from '@/core'
import type { ConversationRagRuntime } from '@/modules/knowledge'
import {
  createWorkflowCheckpointProjectionSession,
  createWorkflowOrchestrator,
  createWorkflowPlanner,
  createWorkflowStepExecutor,
  createWorkflowStepOutcomePolicy,
  extractAndroidWorkflowRuntimeState,
  mergeAndroidWorkflowRuntimeState,
  type AndroidWorkflowRuntimeState,
  type WorkflowDefinitionRecord,
  type WorkflowExecutionRun,
  type WorkflowStep,
  type WorkflowStepToolRequest as AgentToolRequest,
  type WorkflowIntentClassification,
} from '@/modules/tasks'
import {
  formatToolRequestIdentity,
  type ConversationToolCatalogManifest,
} from '@/modules/integrations'
import { sanitizeAndroidApkUri } from '@/services/androidUriPolicy'

import { resolveWorkflowRagEvidencePause } from './workflowRagEvidence'
import {
  executeTaskBoundTool,
  type TaskBoundToolRuntimeOptions,
} from './taskBoundToolRuntime'
import { completeWorkflowRun } from './workflowCompletion'
import { workflowDefinitionPolicy } from './workflowDefinitions'
import { formatWorkflowToolFailureDetails } from './workflowFailure'
import { workflowIntentClassifier } from './workflowIntent'
import {
  projectFailureTraceMetadata,
  projectWorkflowTraceMetadata,
} from './workflowObservation'
import {
  buildPendingAction,
  formatPendingActionOutput,
} from './workflowPendingAction'
import { buildWorkflowPermissionEvidence } from './workflowPermissionEvidence'
import { collectWorkflowRagProfileRequirements } from './workflowSkills'
import { workflowContinuationPolicy } from './workflowContinuation'

type WorkflowDefinition = WorkflowDefinitionRecord
type ConversationToolManifest = ConversationToolCatalogManifest

const createWorkflowPlan = createWorkflowPlanner<
  AgentToolRequest,
  WorkflowDefinition,
  WorkflowIntentClassification
>({
  clock: systemClock,
  classifyIntent: workflowIntentClassifier.classify,
  projectTrace: projectProcessTrace,
  redactText: redactSensitiveText,
  formatToolIdentity: formatToolRequestIdentity,
  collectRagProfileRequirements: collectWorkflowRagProfileRequirements,
  inferClockTime: workflowIntentClassifier.inferClockTime,
  inferReminderDateTimeIso: workflowIntentClassifier.inferReminderDateTimeIso,
  inferReminderTitle: workflowIntentClassifier.inferReminderTitle,
  sanitizeApkUri: sanitizeAndroidApkUri,
})

const executeWorkflowStep = createWorkflowStepExecutor<
  AgentToolRequest,
  TaskBoundToolRuntimeOptions
>({
  clock: systemClock,
  executeTool: ({ stepId, assistantRunId, request, options }) =>
    executeTaskBoundTool({
      stepId,
      ...(assistantRunId ? { assistantRunId } : {}),
      request,
      options,
    }),
  redactText: redactSensitiveText,
  projectTrace: projectProcessTrace,
})

const workflowStepOutcomePolicy = createWorkflowStepOutcomePolicy<
  WorkflowStep,
  NonNullable<WorkflowExecutionRun['pendingAction']>,
  AndroidWorkflowRuntimeState
>({
  cancel: workflowContinuationPolicy.cancel,
  buildPendingAction,
  formatPendingActionOutput,
  formatToolFailureDetails: formatWorkflowToolFailureDetails,
  projectFailureMetadata: projectFailureTraceMetadata,
  extractRuntimeState: extractAndroidWorkflowRuntimeState,
  mergeRuntimeState: mergeAndroidWorkflowRuntimeState,
})

const workflowOrchestrator = createWorkflowOrchestrator<
  ConversationToolManifest,
  ConversationRagRuntime,
  TaskBoundToolRuntimeOptions
>({
  clock: systemClock,
  validateWorkflowDefinition: workflowDefinitionPolicy.validate,
  createPlan: createWorkflowPlan,
  buildStepRuntimeOptions: ({ manifests, ragRuntime, runtimeLog }) => ({
    manifests,
    ragRuntime,
    runtimeLog,
  }),
  executeStep: executeWorkflowStep,
  createCheckpointSession: (input) =>
    createWorkflowCheckpointProjectionSession({
      ...input,
      now: systemClock.now,
      redactText: redactSensitiveText,
    }),
  continuationPolicy: workflowContinuationPolicy,
  resolveStepOutcome: workflowStepOutcomePolicy.resolve,
  buildPermissionEvidence: buildWorkflowPermissionEvidence,
  projectWorkflowTraceMetadata,
  resolveRagEvidencePause: resolveWorkflowRagEvidencePause,
  completeRun: completeWorkflowRun,
})

export const runWorkflow = workflowOrchestrator.run
