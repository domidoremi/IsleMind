import { createSqliteRunBudgetStore, RunBudgetAdmissionError, type AssistantRunGovernance } from '@/modules/assistant-runtime'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { assertExecutionResourcesAvailable, executionSqliteMaintenance, SqliteMaintenanceAdmissionError } from './executionResources'
import { assistantExecutionHost } from './assistantExecutionHostRuntime'
import { projectRunSnapshot } from '@/modules/assistant-runtime/harnessCheckpoint'
import { createRunBudgetDeadlines } from '@/modules/assistant-runtime/application/runBudgetDeadline'
import type { AssistantRunId } from '@/core'
import { ExecutionResourceError } from '@/modules/tasks/application/executionResources'
import { ProviderContextCapacityError } from '@/modules/providers/providerContextCapacity'
import { ProviderExecutionTargetObserverError } from '@/modules/providers'
import { ProviderResponseLimitError } from '@/modules/providers/providerTransportUtils'

let pauseBudgetRun: ((id: AssistantRunId) => Promise<unknown>) | undefined
export function bindBudgetDeadlinePause(handler: NonNullable<typeof pauseBudgetRun>) { pauseBudgetRun = handler }
const deadlines = createRunBudgetDeadlines({ now: Date.now, exhausted: (id) => pauseBudgetRun?.(id as AssistantRunId) })

export const assistantRunBudgetStore = createSqliteRunBudgetStore(createExpoSqliteDatabaseProvider())

export const assistantRunGovernance: AssistantRunGovernance = {
  async created(run) {
    assertExecutionResourcesAvailable()
    if (run.parentRunId) await assistantRunBudgetStore.attach(run.rootRunId!, run.id)
    else await assistantRunBudgetStore.create(run.rootRunId ?? run.id, run.agentDefinition?.budget)
  },
  async lifecycle(run) {
    if (!run.parentRunId) await assistantExecutionHost.persisted(projectRunSnapshot(run))
    // Historical runs have no new-format budget and cannot acquire new dispatch rights.
    const rootRunId = run.rootRunId ?? run.id
    if (!await assistantRunBudgetStore.get(rootRunId)) return
    await assistantRunBudgetStore.setActive(rootRunId, run.status === 'running', Date.now(), run.id)
    const budget = await assistantRunBudgetStore.get(rootRunId)
    if (budget) deadlines.update(budget, budget.activeSince !== undefined)
    if (run.status !== 'running' && run.status !== 'queued') {
      // The durable wait/terminal barrier never waits for WAL disk maintenance.
      void executionSqliteMaintenance.request()
    }
  },
  async beforeAttempt(run, target) {
    assertExecutionResourcesAvailable()
    assistantExecutionHost.assertAdmission(run.rootRunId ?? run.id)
    if (!target.tokenEstimate) throw new RunBudgetAdmissionError('estimate_unavailable')
    await assistantRunBudgetStore.reserve(run.rootRunId ?? run.id, {
      attemptId: target.attemptId, runId: run.id,
      inputEstimate: target.tokenEstimate.inputTokens, outputReservation: target.tokenEstimate.outputTokens,
    }, Date.now())
  },
  admissionPauseReason(error) {
    for (let depth = 0; depth < 4 && error instanceof ProviderExecutionTargetObserverError; depth++) error = error.cause
    if (error instanceof RunBudgetAdmissionError) return error.reason === 'price_unknown' ? 'price_unknown' : 'budget_exhausted'
    if (error instanceof ExecutionResourceError) return 'memory_pressure'
    if (error instanceof ProviderResponseLimitError) return 'memory_pressure'
    if (error instanceof ProviderContextCapacityError) return 'context_capacity'
    if (error instanceof SqliteMaintenanceAdmissionError) return 'storage_pressure'
    return undefined
  },
}
