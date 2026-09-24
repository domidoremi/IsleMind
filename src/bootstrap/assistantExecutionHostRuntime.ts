import type { AssistantRunId } from '@/core'
import { createExpoAndroidAgentExecutionPort } from '@/platform/native/androidAgentExecution'
import { createAssistantExecutionHost, type ExecutionHostPauseReason } from './assistantExecutionHost'
import { executionResources } from './executionResources'
import { releaseOnnxEmbeddingResources, trimIdleOnnxEmbeddingResources } from './knowledgeEmbeddingProvider'

let pauseRun: ((runId: AssistantRunId, reason: ExecutionHostPauseReason) => Promise<unknown>) | undefined
export function bindAssistantExecutionPause(handler: NonNullable<typeof pauseRun>) { pauseRun = handler }
export const assistantExecutionHost = createAssistantExecutionHost({
  port: createExpoAndroidAgentExecutionPort(), resources: executionResources,
  pause: (runId, reason) => pauseRun ? pauseRun(runId, reason) : Promise.reject(new Error('Harness is not initialized')),
  trimCaches: (critical) => {
    // No snapshot, database deletion, model load or GC in the trim callback.
    // Retirement defers disposal of in-flight native sessions until they settle.
    void (critical ? releaseOnnxEmbeddingResources() : trimIdleOnnxEmbeddingResources()).catch(() => undefined)
  },
})
