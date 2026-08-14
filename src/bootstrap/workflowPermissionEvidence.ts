import { createWorkflowPermissionEvidencePolicy } from '@/modules/tasks'
import { formatToolRequestIdentity } from '@/modules/integrations'
import { clampTraceText, redactSensitiveText } from '@/core'

export const workflowPermissionEvidencePolicy =
  createWorkflowPermissionEvidencePolicy({
    formatToolIdentity: formatToolRequestIdentity,
    redactText: redactSensitiveText,
    clampText: clampTraceText,
  })

export const { build: buildWorkflowPermissionEvidence } =
  workflowPermissionEvidencePolicy
