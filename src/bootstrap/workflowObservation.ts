import { createWorkflowObservationPolicy } from '@/modules/tasks'
import { clampTraceText, redactSensitiveText } from '@/core'

export const workflowObservationPolicy = createWorkflowObservationPolicy({
  redactText: redactSensitiveText,
  clampText: clampTraceText,
})

export const {
  projectWorkflowTraceMetadata,
  projectStepAttribution,
  projectFailureTraceMetadata,
  appendPendingActionPromptContext,
} = workflowObservationPolicy
