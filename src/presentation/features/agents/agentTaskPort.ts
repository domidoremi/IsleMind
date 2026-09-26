import type { StreamEvent } from '@/core'
import type {
  AgentDefinitionRepository, AssistantRun, AssistantRuntime, AssistantRunSummary, RunBudgetSnapshot,
} from '@/modules/assistant-runtime'

/** Commands injected by bootstrap; presentation cannot construct or own execution. */
export interface AgentTaskPort {
  definitions: Pick<AgentDefinitionRepository, 'list'>
  listRuns(conversationId?: string): Promise<readonly AssistantRunSummary[]>
  get(id: string): Promise<AssistantRun | undefined>
  budget(id: string): Promise<RunBudgetSnapshot | undefined>
  sources(id: string): Promise<readonly Extract<StreamEvent, { type: 'citation' }>[]>
  subscribe: AssistantRuntime['subscribe']
  backgroundEnabled(id: string): boolean
  setBackground(id: string, enabled: boolean): Promise<void>
  start(input: { conversationId: string; agentId: string; text: string; background?: boolean; taskKind?: 'chat' | 'research' | 'artifact' }): Promise<AssistantRun>
  resume(id: string): Promise<AssistantRun>
  approve(id: string, approved: boolean, identity: { continuationToken: string; continuationDigest: string }): Promise<AssistantRun>
  pause(id: string): ReturnType<AssistantRuntime['pause']>
  cancel(id: string): ReturnType<AssistantRuntime['cancel']>
  steer(id: string, text: string): ReturnType<AssistantRuntime['steer']>
  saveDocument(id: string, title: string): Promise<unknown>
}
