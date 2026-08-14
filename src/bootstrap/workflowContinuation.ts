import { systemClock, redactSensitiveText } from '@/core'
import { createWorkflowContinuationPolicy } from '@/modules/tasks'

export const workflowContinuationPolicy = createWorkflowContinuationPolicy({
  clock: systemClock,
  redactText: redactSensitiveText,
})
