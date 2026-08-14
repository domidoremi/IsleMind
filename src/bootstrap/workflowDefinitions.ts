import { redactSensitiveText, systemClock } from '@/core'
import { resolveUniqueToolManifest } from '@/modules/integrations'
import { createWorkflowDefinitionPolicy } from '@/modules/tasks'

export const workflowDefinitionPolicy = createWorkflowDefinitionPolicy({
  clock: systemClock,
  generateIdSuffix: () => Math.random().toString(36).slice(2, 8),
  redactSensitiveText,
  resolveUniqueManifest: (request, manifests) => resolveUniqueToolManifest(request, manifests),
})
