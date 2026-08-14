import { clampTraceText, redactSensitiveText } from '@/core'
import { WORK_ARTIFACT_WORKFLOW_CONTRACT } from '@/modules/integrations'
import { createWorkflowMessageActionPolicy } from '@/modules/tasks'

const workflowMessageActionPolicy = createWorkflowMessageActionPolicy({
  projectText(value, limit) {
    return clampTraceText(redactSensitiveText(value).trim(), limit).trim()
  },
  redactText: redactSensitiveText,
  workArtifactWorkflowContract: WORK_ARTIFACT_WORKFLOW_CONTRACT,
})

export const {
  getWorkflowPendingActionFromMessage,
  getWorkflowEvidenceRepairActionFromMessage,
  getWorkflowRecoveryActionFromMessage,
  getWorkflowContinuationActionFromMessage,
} = workflowMessageActionPolicy

export type {
  WorkflowContinuationAction,
  WorkflowContinuationReason,
  WorkflowEvidenceRepairAction,
  WorkflowMessagePendingAction,
  WorkflowRecoveryAction,
  WorkflowRecoveryReason,
} from '@/modules/tasks'
