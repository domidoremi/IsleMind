import { systemClock } from '@/core'
import { createAssistantRuntime, createSqliteAssistantRunPersistence, type AssistantRuntime } from '@/modules/assistant-runtime'
import { createProviderGateway, type ProviderGateway } from '@/modules/providers'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { assistantRunGovernance, bindBudgetDeadlinePause } from './assistantRunGovernance'
import { bindAssistantExecutionPause } from './assistantExecutionHostRuntime'
import { agentHarnessNewRunsEnabled } from '@/platform/native/agentHarnessAdmission'

export const assistantRunPersistence = createSqliteAssistantRunPersistence(createExpoSqliteDatabaseProvider())
let sequence = 0

/** All foreground, workflow and background work shares one cancellation/continuation owner. */
export const applicationAssistantRuntime = createAssistantRuntime({
  clock: systemClock,
  ids: { next: (prefix) => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}` },
  persistence: assistantRunPersistence,
  providerGateway: createProviderGateway([]),
  governance: assistantRunGovernance,
  options: { newRunsEnabled: agentHarnessNewRunsEnabled() },
})
bindAssistantExecutionPause((runId, reason) => applicationAssistantRuntime.pause(runId,
  reason === 'memory_pressure' ? 'memory_pressure' : reason === 'background_disabled' ? 'application_background' : 'background_lease'))
bindBudgetDeadlinePause((id) => applicationAssistantRuntime.pause(id, 'budget_exhausted'))

/** Binds a frozen provider route without creating another active-run registry. */
export function bindAssistantRuntimeGateway(providerGateway: ProviderGateway): AssistantRuntime {
  return {
    ...applicationAssistantRuntime,
    start: (input) => applicationAssistantRuntime.start({ ...input, providerGateway }),
    resume: (input) => applicationAssistantRuntime.resume({ ...input, providerGateway }),
    approve: (input) => applicationAssistantRuntime.approve({ ...input, providerGateway }),
    execute: (input) => applicationAssistantRuntime.execute({ ...input, providerGateway }),
    resumeModelOperation: (input) => applicationAssistantRuntime.resumeModelOperation({ ...input, providerGateway }),
  }
}
