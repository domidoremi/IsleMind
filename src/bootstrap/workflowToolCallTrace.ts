import { createWorkflowToolCallTracePolicy } from '@/modules/tasks'
import { redactSensitiveText, sanitizeTraceMetadataValue } from '@/core'

export const workflowToolCallTracePolicy = createWorkflowToolCallTracePolicy({
  redactSensitiveText,
  sanitizeTraceMetadataValue,
})

export const {
  buildWorkflowToolCallTraceMetadata,
  inferWorkflowToolNameFromTraceContent,
  validateWorkflowToolCallTraceContract,
  extractWorkflowToolCallTraceShape,
  equivalentWorkflowToolCallTraceShape,
  stripWorkflowToolRequestBlocks,
  containsRawWorkflowToolRequestJson,
} = workflowToolCallTracePolicy
