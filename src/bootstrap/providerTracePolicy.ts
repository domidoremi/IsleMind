import { st } from '@/i18n/service'
import { createProviderTracePolicy } from '@/modules/providers'
import { buildWorkflowToolCallTraceMetadata, inferWorkflowToolNameFromTraceContent } from '@/bootstrap/workflowToolCallTrace'
import { redactSensitiveText } from '@/core'

export const providerTracePolicy = createProviderTracePolicy({
  translate: st,
  buildToolCallMetadata: buildWorkflowToolCallTraceMetadata,
  inferToolName: inferWorkflowToolNameFromTraceContent,
  redact: redactSensitiveText,
})

export const { createProviderTrace, extractTracesFromJson, summarizeToolEvent } = providerTracePolicy
