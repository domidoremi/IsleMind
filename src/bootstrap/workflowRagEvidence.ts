import { clampTraceText, redactSensitiveText, systemClock } from '@/core'
import { createWorkflowRagEvidencePolicy } from '@/modules/tasks'

import {
  appendPendingActionPromptContext,
  projectStepAttribution,
} from './workflowObservation'

export const workflowRagEvidencePolicy = createWorkflowRagEvidencePolicy({
  clock: systemClock,
  redactText: redactSensitiveText,
  clampText: clampTraceText,
  projectStepAttribution,
  appendPendingActionPromptContext,
})

export const { resolvePause: resolveWorkflowRagEvidencePause } = workflowRagEvidencePolicy
