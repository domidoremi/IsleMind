declare const assistantRunIdBrand: unique symbol
declare const contextSnapshotIdBrand: unique symbol
declare const taskIdBrand: unique symbol

export type AssistantRunId = string & { readonly [assistantRunIdBrand]: 'AssistantRunId' }
export type ContextSnapshotId = string & { readonly [contextSnapshotIdBrand]: 'ContextSnapshotId' }
export type TaskId = string & { readonly [taskIdBrand]: 'TaskId' }

export interface IdGenerator {
  next(prefix: string): string
}

export function asAssistantRunId(value: string): AssistantRunId {
  return value as AssistantRunId
}

export function asContextSnapshotId(value: string): ContextSnapshotId {
  return value as ContextSnapshotId
}

export function asTaskId(value: string): TaskId {
  return value as TaskId
}

export function createAssistantRunId(ids: IdGenerator): AssistantRunId {
  return asAssistantRunId(ids.next('run'))
}

export function createContextSnapshotId(ids: IdGenerator): ContextSnapshotId {
  return asContextSnapshotId(ids.next('context'))
}

export function createTaskId(ids: IdGenerator): TaskId {
  return asTaskId(ids.next('task'))
}
