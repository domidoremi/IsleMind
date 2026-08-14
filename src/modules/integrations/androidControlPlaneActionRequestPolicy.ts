import type {
  ControlPlaneActionRequest,
  ControlPlaneActionRequestCreation,
  ControlPlaneActionRoute,
  ControlPlaneInstallActionKind,
  ControlPlanePermission,
  ControlPlaneSnapshot,
  ControlPlaneSuggestedTaskStatus,
  ControlPlaneToolCard,
} from './androidControlPlaneActionPolicy'

export interface AndroidControlPlaneActionRequestSnapshot extends ControlPlaneSnapshot {
  actionBadges: ReadonlyArray<{ kind: ControlPlaneInstallActionKind }>
  runtimeBadges: ReadonlyArray<{ runtimeId: string }>
  toolCards: readonly ControlPlaneToolCard[]
}

export interface AndroidControlPlaneActionRequestInput<
  TSnapshot extends AndroidControlPlaneActionRequestSnapshot,
> {
  snapshot: TSnapshot
  actionKind: ControlPlaneInstallActionKind
  toolId?: string
  runtimeId?: string
  now?: number
}

export interface AndroidControlPlaneActionRequestPolicyDependencies<
  TSnapshot extends AndroidControlPlaneActionRequestSnapshot,
  TRequest extends ControlPlaneActionRequest,
  TCreation extends ControlPlaneActionRequestCreation<TRequest>,
  TActionSchema extends string,
> {
  actionSchema: TActionSchema
  actionKinds: readonly ControlPlaneInstallActionKind[]
  eventEntryLimit: number
  selectToolCards(
    snapshot: TSnapshot,
    actionKind: ControlPlaneInstallActionKind,
    toolId: string | undefined,
    runtimeId: string | undefined,
  ): ControlPlaneToolCard[]
  routeForAction(actionKind: ControlPlaneInstallActionKind): ControlPlaneActionRoute
  permissionsForAction(actionKind: ControlPlaneInstallActionKind, cards: readonly ControlPlaneToolCard[]): ControlPlanePermission[]
  suggestedTaskStatus(actionKind: ControlPlaneInstallActionKind): ControlPlaneSuggestedTaskStatus | undefined
  buildActionSummary(actionKind: ControlPlaneInstallActionKind, toolCount: number, runtimeCount: number): string
  createFailure(errorCode: 'action_unavailable' | 'tool_unavailable' | 'runtime_unavailable' | 'unknown_action' | 'operation_mismatch', message: string): TCreation
  createActionId(actionKind: ControlPlaneInstallActionKind, toolIds: string[], runtimeIds: string[], now: number): string
  sanitizeStableIds(input: unknown, limit: number): string[]
  sanitizeDependencyKeys(input: unknown): string[]
  sanitizeTimestamp(input: unknown): number | undefined
  isTrustedSnapshot(input: unknown): input is TSnapshot
}

const ACTION_REQUEST_INPUT_KEYS = ['snapshot', 'actionKind', 'toolId', 'runtimeId', 'now'] as const

export function createAndroidControlPlaneActionRequestPolicy<
  TSnapshot extends AndroidControlPlaneActionRequestSnapshot,
  TRequest extends ControlPlaneActionRequest,
  TCreation extends ControlPlaneActionRequestCreation<TRequest>,
  const TActionSchema extends string,
>(dependencies: AndroidControlPlaneActionRequestPolicyDependencies<TSnapshot, TRequest, TCreation, TActionSchema>) {
  type RequestInput = AndroidControlPlaneActionRequestInput<TSnapshot>

  function createActionRequest(input: RequestInput): TCreation {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, ACTION_REQUEST_INPUT_KEYS)) {
      return dependencies.createFailure(
        'operation_mismatch',
        'Control-plane action request input contains unsupported metadata.'
      )
    }
    const now = dependencies.sanitizeTimestamp(input.now) ?? Date.now()
    if (!dependencies.actionKinds.includes(input.actionKind)) {
      return dependencies.createFailure(
        'unknown_action',
        'Control-plane action is not part of the toolchain action contract.'
      )
    }
    if (!dependencies.isTrustedSnapshot(input.snapshot)) {
      return dependencies.createFailure(
        'action_unavailable',
        'Control-plane snapshot identity is not trusted for action routing.'
      )
    }
    if (input.runtimeId && !input.snapshot.runtimeBadges.some((badge) => badge.runtimeId === input.runtimeId)) {
      return dependencies.createFailure(
        'runtime_unavailable',
        'Requested runtime is not present in the Android control-plane snapshot.'
      )
    }
    const toolCards = dependencies.selectToolCards(
      input.snapshot,
      input.actionKind,
      input.toolId,
      input.runtimeId
    )
    if (input.toolId && !input.snapshot.toolCards.some((card) => card.id === input.toolId)) {
      return dependencies.createFailure(
        'tool_unavailable',
        'Requested tool is not present in the Android control-plane snapshot.'
      )
    }
    if (!toolCards.length) {
      return dependencies.createFailure(
        'action_unavailable',
        'Requested control-plane action is not available for the current snapshot.'
      )
    }
    const route = dependencies.routeForAction(input.actionKind)
    const toolIds = dependencies.sanitizeStableIds(
      toolCards.map((card) => card.id),
      dependencies.eventEntryLimit
    )
    const runtimeIds = dependencies.sanitizeStableIds(
      toolCards.map((card) => card.runtimeId).filter((value): value is string => Boolean(value)),
      dependencies.eventEntryLimit
    )
    const permissions = dependencies.permissionsForAction(input.actionKind, toolCards)
    const dependencyKeys = dependencies.sanitizeDependencyKeys(
      toolCards.flatMap((card) => card.missingDependencies)
    )
    return {
      ok: true,
      request: {
        schema: dependencies.actionSchema,
        controlPlaneSchema: input.snapshot.schema,
        generatedAt: now,
        actionId: dependencies.createActionId(input.actionKind, toolIds, runtimeIds, now),
        actionKind: input.actionKind,
        route,
        projectId: input.snapshot.projectId,
        toolIds,
        runtimeIds,
        permissions,
        dependencies: dependencyKeys,
        requiresUserInteraction: true,
        requiresRuntimePairing: input.actionKind === 'pair-runtime' || input.actionKind === 'register-runtime-tool',
        suggestedTaskStatus: dependencies.suggestedTaskStatus(input.actionKind),
        summary: dependencies.buildActionSummary(input.actionKind, toolIds.length, runtimeIds.length),
      } as unknown as TRequest,
    } as TCreation
  }

  function buildActionRequests(
    snapshot: TSnapshot,
    now: number,
  ): TRequest[] {
    if (!dependencies.isTrustedSnapshot(snapshot)) return []
    const generatedAt = dependencies.sanitizeTimestamp(now) ?? Date.now()
    const requests: TRequest[] = []
    for (const badge of snapshot.actionBadges) {
      const result = createActionRequest({ snapshot, actionKind: badge.kind, now: generatedAt })
      if (result.ok && result.request) requests.push(result.request)
      if (requests.length >= dependencies.eventEntryLimit) break
    }
    return requests
  }

  return Object.freeze({ createActionRequest, buildActionRequests })
}

function hasOnlyAllowedKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(input).every((key) => allowed.has(key))
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}
