import { createAndroidWorkflowCatalog } from '@/modules/tasks'
import { sanitizeAndroidApkUri } from '@/services/androidUriPolicy'
import { workflowDefinitionPolicy } from '@/bootstrap/workflowDefinitions'

export const androidWorkflowCatalog = createAndroidWorkflowCatalog({
  definitionPolicy: workflowDefinitionPolicy,
  sanitizeApkUri: sanitizeAndroidApkUri,
})
