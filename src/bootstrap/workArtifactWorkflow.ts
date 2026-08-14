import { createWorkArtifactWorkflowPolicy } from '@/modules/integrations'
import { summarizeWorkArtifact, validateWorkArtifactQuality } from '@/utils/workArtifact'
import { containsSensitiveText, redactSensitiveText } from '@/core'

const workArtifactWorkflowPolicy = createWorkArtifactWorkflowPolicy({
  summarizeWorkArtifact,
  validateWorkArtifactQuality,
  containsSensitiveText,
  redactSensitiveText,
})

export const {
  buildWorkArtifactWorkflowOutput,
  validateWorkArtifactWorkflowOutput,
  parseWorkArtifactWorkflowOutputJson,
} = workArtifactWorkflowPolicy
