import { systemClock, type IdGenerator } from '@/core'
import {
  createAssistantChatWorkflowRunRuntime,
  type AssistantChatWorkflowRunRuntime,
} from '@/modules/assistant-runtime'
import {
  createContextSnapshotAssembler,
  createSqliteContextSnapshotRepository,
  type AssembledContext,
  type KnowledgeContextRetriever,
} from '@/modules/knowledge'
import { createWorkflowCheckpointRuntime } from './workflowCheckpoints'
import {
  type WorkflowCheckpointStore,
} from '@/modules/tasks'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { applicationAssistantRuntime } from './applicationAssistantRuntime'

const databaseProvider = createExpoSqliteDatabaseProvider()
const contextSnapshots = createSqliteContextSnapshotRepository(databaseProvider)
const workflowCheckpoints = createWorkflowCheckpointRuntime(databaseProvider)
let idSequence = 0

const ids: IdGenerator = {
  next(prefix) {
    idSequence += 1
    return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  },
}

export interface ChatWorkflowRuntimeOptions {
  contextRetriever?: KnowledgeContextRetriever
}

export interface ChatWorkflowRuntime
  extends AssistantChatWorkflowRunRuntime<AssembledContext> {
  workflowCheckpoints: WorkflowCheckpointStore
}

export function createChatWorkflowRuntime(
  options: ChatWorkflowRuntimeOptions = {},
): ChatWorkflowRuntime {
  const contextSnapshotAssembler = createContextSnapshotAssembler({
    clock: systemClock,
    ids,
    repository: contextSnapshots,
    ...(options.contextRetriever ? { retriever: options.contextRetriever } : {}),
  })
  const chatWorkflows = createAssistantChatWorkflowRunRuntime({
    ids,
    assistantRuntime: applicationAssistantRuntime,
    contextAssembly: contextSnapshotAssembler,
  })
  return Object.assign(chatWorkflows, { workflowCheckpoints })
}
