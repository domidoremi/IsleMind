import type { InstallActionKind, InstallPlanCounts } from './installPlanPolicy'
import type {
  AdmittedRuntimeCapability,
  AdmittedRuntimeKind,
} from './toolchainManifestAdmission'

export interface AndroidControlPlanePresentationAction {
  kind: InstallActionKind
  toolIds: string[]
}

export interface AndroidControlPlanePresentationActionBadge {
  kind: InstallActionKind
  count: number
  toolIds: string[]
}

export interface AndroidControlPlanePresentationRuntimeSnapshot {
  id: string
  name: string
  kind: AdmittedRuntimeKind
  protocolSchema: string
  online: boolean
  capabilities: AdmittedRuntimeCapability[]
  dependencies?: Record<string, string>
  lastSeenAt?: number
}

export interface AndroidControlPlanePresentationRuntimeBadge {
  runtimeId: string
  name: string
  kind: AdmittedRuntimeKind
  online: boolean
  protocolReady: boolean
  capabilityCount: number
  dependencyKeys: string[]
  lastSeenAt?: number
}

export interface AndroidControlPlanePresentationSummaryInput {
  installCounts: InstallPlanCounts
  registeredReadyCount: number
  doctorStatus: string
  activeTasks: readonly { requiresAttention: boolean; canRequestCancel: boolean }[]
  registeredLaunchCards: readonly { dispatchRequiresPairedRuntime: boolean }[]
  gatewayCards: readonly { ready: boolean }[]
  pairingAcceptanceCards: readonly { status: 'accepted' | 'rejected' }[]
  runtimes: readonly { online: boolean }[]
}

export interface AndroidControlPlanePresentationPolicyConfiguration<
  TRuntime extends AndroidControlPlanePresentationRuntimeSnapshot,
> {
  cardLimit: number
  actionToolIdLimit: number
  actionBadgeLimit: number
  runtimeProtocolSchema: string
  createTrustedRuntimeSnapshots(input: readonly TRuntime[]): TRuntime[]
  sanitizeStableIdList(input: unknown, limit: number): string[]
  sanitizeDependencyKeyList(input: unknown): string[]
}

export function createAndroidControlPlanePresentationPolicy<
  TRuntime extends AndroidControlPlanePresentationRuntimeSnapshot,
>(config: AndroidControlPlanePresentationPolicyConfiguration<TRuntime>) {
  function buildAndroidControlPlaneSummary(input: AndroidControlPlanePresentationSummaryInput): string {
    const onlineRuntimes = input.runtimes.filter((runtime) => runtime.online).length
    const needsAction = input.installCounts.needs_permission + input.installCounts.needs_runtime +
      input.installCounts.needs_confirmation + input.installCounts.blocked
    const attentionTasks = input.activeTasks.filter((task) => task.requiresAttention).length
    const cancelableTasks = input.activeTasks.filter((task) => task.canRequestCancel).length
    const registeredRuntimeLaunches = input.registeredLaunchCards
      .filter((launch) => launch.dispatchRequiresPairedRuntime).length
    const readyGateways = input.gatewayCards.filter((gateway) => gateway.ready).length
    const rejectedPairings = input.pairingAcceptanceCards.filter((acceptance) => acceptance.status === 'rejected').length
    return `${input.installCounts.installable} installable tool(s), ${input.registeredReadyCount} registered tool(s) ready, ${needsAction} need action, ${input.activeTasks.length} active task(s), ${attentionTasks} task(s) need attention, ${cancelableTasks} task cancel action(s) available, ${input.registeredLaunchCards.length} registered launch(es), ${registeredRuntimeLaunches} runtime launch(es), ${readyGateways} MCP gateway session(s) ready, ${input.pairingAcceptanceCards.length} runtime pairing result(s), ${rejectedPairings} pairing issue(s), ${onlineRuntimes} runtime(s) online; doctor is ${input.doctorStatus}.`
  }

  function buildControlPlaneActionBadges(
    actions: readonly AndroidControlPlanePresentationAction[],
  ): AndroidControlPlanePresentationActionBadge[] {
    const grouped = new Map<InstallActionKind, { count: number; toolIds: string[] }>()
    for (const action of actions) {
      const current = grouped.get(action.kind) ?? { count: 0, toolIds: [] }
      current.count += 1
      current.toolIds.push(...action.toolIds)
      grouped.set(action.kind, current)
    }
    return Array.from(grouped.entries())
      .map(([kind, value]) => ({
        kind,
        count: value.count,
        toolIds: config.sanitizeStableIdList(value.toolIds, config.actionToolIdLimit),
      }))
      .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind))
      .slice(0, config.actionBadgeLimit)
  }

  function buildControlPlaneRuntimeBadges(
    runtimes: readonly TRuntime[],
  ): AndroidControlPlanePresentationRuntimeBadge[] {
    return config.createTrustedRuntimeSnapshots(runtimes)
      .slice(0, config.cardLimit)
      .map((runtime) => ({
        runtimeId: runtime.id,
        name: runtime.name,
        kind: runtime.kind,
        online: runtime.online,
        protocolReady: runtime.protocolSchema === config.runtimeProtocolSchema,
        capabilityCount: runtime.capabilities.length,
        dependencyKeys: config.sanitizeDependencyKeyList(Object.keys(runtime.dependencies ?? {})),
        lastSeenAt: runtime.lastSeenAt,
      }))
  }

  return {
    buildAndroidControlPlaneSummary,
    buildControlPlaneActionBadges,
    buildControlPlaneRuntimeBadges,
  }
}
