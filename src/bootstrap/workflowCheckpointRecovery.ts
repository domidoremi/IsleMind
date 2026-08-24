import type { AssistantRunId } from '@/core'
import {
  createWorkflowCheckpointRecoveryCoordinator,
  type WorkflowCheckpointRecoveryReport,
} from '@/modules/tasks'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { createWorkflowCheckpointRuntime } from './workflowCheckpoints'

const workflowCheckpointRecoveryCoordinator = createWorkflowCheckpointRecoveryCoordinator(
  createWorkflowCheckpointRuntime(createExpoSqliteDatabaseProvider()),
)

export function recoverWorkflowCheckpoints(
  recoveredRunIds: readonly AssistantRunId[],
  options: { readonly signal: AbortSignal },
): Promise<WorkflowCheckpointRecoveryReport> {
  return workflowCheckpointRecoveryCoordinator.recover(recoveredRunIds, options.signal)
}
