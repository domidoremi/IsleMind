import type { Clock, IdGenerator } from '@/core'
import {
  createAssistantRuntime,
  type AssistantRunPersistence,
  type AssistantRuntime,
  type AssistantRuntimeOptions,
  type AssistantRunGovernance,
} from '@/modules/assistant-runtime'
import {
  createProviderGateway,
  type ProviderAdapter,
  type ProviderGateway,
} from '@/modules/providers'

export interface AppContainerDependencies {
  clock: Clock
  ids: IdGenerator
  providerAdapters: readonly ProviderAdapter[]
  providerGateway?: ProviderGateway
  runPersistence: AssistantRunPersistence
  assistantRuntimeOptions?: AssistantRuntimeOptions
  governance?: AssistantRunGovernance
}

export interface AppContainer {
  providerGateway: ProviderGateway
  assistantRuntime: AssistantRuntime
}

export function createAppContainer(dependencies: AppContainerDependencies): AppContainer {
  const providerGateway = dependencies.providerGateway ??
    createProviderGateway(dependencies.providerAdapters)
  const assistantRuntime = createAssistantRuntime({
    clock: dependencies.clock,
    ids: dependencies.ids,
    providerGateway,
    persistence: dependencies.runPersistence,
    governance: dependencies.governance,
    ...(dependencies.assistantRuntimeOptions ? { options: dependencies.assistantRuntimeOptions } : {}),
  })

  return { providerGateway, assistantRuntime }
}
