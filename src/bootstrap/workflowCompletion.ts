import { createWorkflowCompletionPolicy } from '@/modules/tasks'
import { clampTraceText, projectProcessTrace, redactSensitiveText } from '@/core'
import { projectWorkflowTraceMetadata } from '@/bootstrap/workflowObservation'
import {
  formatWorkflowFailureOutput,
  resolveWorkflowFailureNextStep,
} from '@/bootstrap/workflowFailure'

export const workflowCompletionPolicy = createWorkflowCompletionPolicy({
  clock: { now: () => Date.now() },
  redactText: redactSensitiveText,
  clampText: clampTraceText,
  projectTrace: projectProcessTrace,
  projectWorkflowTraceMetadata,
  formatFailureOutput: formatWorkflowFailureOutput,
  resolveFailureNextStep: resolveWorkflowFailureNextStep,
})

export const completeWorkflowRun = workflowCompletionPolicy.complete
