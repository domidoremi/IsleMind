import { projectProcessTrace, systemClock } from '@/core'
import { createWorkflowIntentClassifier } from '@/modules/tasks'

export const workflowIntentClassifier = createWorkflowIntentClassifier({
  clock: systemClock,
  projectTrace: projectProcessTrace,
})
