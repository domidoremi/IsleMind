import { createSqliteRunBudgetStore, createRunBudgetDeadlines, projectRunSnapshot, RunBudgetAdmissionError, type AssistantRunGovernance } from '@/modules/assistant-runtime'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { assertExecutionResourcesAvailable, executionResources, executionSqliteMaintenance, SqliteMaintenanceAdmissionError } from './executionResources'
import { assistantExecutionHost } from './assistantExecutionHostRuntime'
import { JsonTextBudgetError, type AssistantRunId } from '@/core'
import { ExecutionResourceError } from '@/modules/tasks'
import { ProviderContextCapacityError, ProviderExecutionTargetObserverError, ProviderResponseLimitError } from '@/modules/providers'

let pauseBudgetRun: ((id: AssistantRunId) => Promise<unknown>) | undefined
export function bindBudgetDeadlinePause(handler: NonNullable<typeof pauseBudgetRun>) { pauseBudgetRun = handler }
const deadlines = createRunBudgetDeadlines({ now: Date.now, exhausted: (id) => pauseBudgetRun?.(id as AssistantRunId) })

export const assistantRunBudgetStore = createSqliteRunBudgetStore(createExpoSqliteDatabaseProvider())

export const assistantRunGovernance: AssistantRunGovernance = {
  executionStarted: (scope) => assistantExecutionHost.executionStarted(scope),
  reserveText: (bytes) => executionResources.reserveText(bytes),
  reserveStopText: (bytes) => executionResources.reserveStopText(bytes),
  async recoverInterrupted(isActiveRoot) {
    const recovered = await assistantRunBudgetStore.recoverActiveTime(isActiveRoot)
    for (const rootRunId of recovered) if (!isActiveRoot(rootRunId)) deadlines.clear(rootRunId)
  },
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
    if (error instanceof JsonTextBudgetError) return 'memory_pressure'
    if (error instanceof ProviderResponseLimitError) return 'memory_pressure'
    if (error instanceof ProviderContextCapacityError) return 'context_capacity'
    if (error instanceof SqliteMaintenanceAdmissionError) return 'storage_pressure'
    return undefined
  },
}
