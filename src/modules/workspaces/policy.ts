export interface ChatWorkspaceRuntimePolicy {
  readonly runtimeKind: 'conversation'
  readonly memoryScope: 'conversation'
  readonly canRunInParallel: true
}

export const CHAT_WORKSPACE_RUNTIME_POLICY: Readonly<ChatWorkspaceRuntimePolicy> = Object.freeze({
  runtimeKind: 'conversation',
  memoryScope: 'conversation',
  canRunInParallel: true,
})

export function getChatWorkspaceRuntimePolicy(): Readonly<ChatWorkspaceRuntimePolicy> {
  if (arguments.length !== 0) {
    throw new TypeError('The Chat workspace runtime policy does not accept a historical product mode.')
  }

  return CHAT_WORKSPACE_RUNTIME_POLICY
}
