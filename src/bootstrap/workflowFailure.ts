import { clampTraceText, redactSensitiveText } from '@/core'
import { createWorkflowFailurePolicy } from '@/modules/tasks'

export const workflowFailurePolicy = createWorkflowFailurePolicy({
  redactText: redactSensitiveText,
  clampText: clampTraceText,
})

export const formatWorkflowFailureOutput = workflowFailurePolicy.formatFailureOutput
export const formatWorkflowToolFailureDetails = workflowFailurePolicy.formatToolFailureDetails
export const resolveWorkflowFailureNextStep = workflowFailurePolicy.resolveFailureNextStep
