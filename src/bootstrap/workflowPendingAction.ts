import { clampTraceText, redactSensitiveText, systemClock } from '@/core'
import { createWorkflowPendingActionPolicy } from '@/modules/tasks'
import { st } from '@/i18n/service'

import {
  appendPendingActionPromptContext,
  projectStepAttribution,
} from './workflowObservation'

export const workflowPendingActionPolicy = createWorkflowPendingActionPolicy({
  clock: systemClock,
  redactText: redactSensitiveText,
  clampText: clampTraceText,
  localize: st,
  projectStepAttribution,
  appendPendingActionPromptContext,
})

export const { buildPendingAction, formatPendingActionOutput } =
  workflowPendingActionPolicy
