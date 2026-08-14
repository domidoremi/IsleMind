import { createWorkflowToolPermissionPolicy } from '@/modules/tasks'
import {
  decideToolPermission,
  resolveManifestExecutionPolicy,
  resolveToolPermissionEvidence,
  validateToolInputSchema,
} from '@/modules/integrations'
import { projectProcessTrace } from '@/core'

export const workflowToolPermissionPolicy = createWorkflowToolPermissionPolicy({
  now: () => Date.now(),
  projectTrace: projectProcessTrace,
  decidePermission: decideToolPermission,
  resolveEvidence: resolveToolPermissionEvidence,
  resolveExecutionPolicy: resolveManifestExecutionPolicy,
  validateInput: validateToolInputSchema,
})

export const {
  decideWorkflowToolPermission,
  validateWorkflowToolInput,
} = workflowToolPermissionPolicy
