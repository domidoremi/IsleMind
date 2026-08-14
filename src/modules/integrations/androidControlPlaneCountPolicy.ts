import type {
  CountInstallStatus,
  CountRegisteredStatus,
  RegisteredCatalogCounts,
  RegistrySnapshotCounts,
  ToolchainCountInstallPlanCounts,
} from './toolchainCountPolicy'

type RegistryStatus = 'ready' | 'needs_permission' | 'waiting_for_user' | 'unsupported' | 'invalid'
type RegistrationKind = 'app-action' | 'runtime-tool'
type BinaryStatus = 'accepted' | 'rejected'
type TaskCancelErrorCode =
  | 'terminal_task'
  | 'runtime_mismatch'
  | 'runtime_unavailable'
  | 'capability_missing'
  | 'invalid_transition'
  | 'operation_mismatch'

export interface AndroidControlPlaneToolCountCard {
  status: CountInstallStatus
  registryStatus: RegistryStatus
}

export interface AndroidControlPlaneRegisteredToolCountCard {
  status: CountRegisteredStatus
  registrationKind: RegistrationKind
}

export interface AndroidControlPlaneTaskCancelCard {
  canRequestCancel: boolean
  cancelErrorCode?: TaskCancelErrorCode
  requiresAttention: boolean
}

export interface AndroidControlPlaneRegisteredLaunchCountCard {
  status: 'queued'
  hasRuntimePairingAcceptance: boolean
  androidCanExecute: boolean
  dispatchRequiresPairedRuntime: boolean
}

export interface AndroidControlPlaneBinaryStatusCard {
  status: BinaryStatus
}

export interface AndroidControlPlaneSummarySnapshot {
  installCounts: ToolchainCountInstallPlanCounts
  registeredCounts: RegisteredCatalogCounts
  taskCards: readonly AndroidControlPlaneTaskCancelCard[]
  registeredLaunchCards: readonly AndroidControlPlaneRegisteredLaunchCountCard[]
  gatewayCards: readonly { ready: boolean }[]
  pairingAcceptanceCards: readonly AndroidControlPlaneBinaryStatusCard[]
  runtimeBadges: readonly { online: boolean }[]
  doctorStatus: string
}

export interface AndroidControlPlaneTaskCancelCounts {
  total: number
  available: number
  blocked: number
  terminalTask: number
  runtimeMismatch: number
  runtimeUnavailable: number
  capabilityMissing: number
  invalidTransition: number
}

export interface AndroidControlPlaneRegisteredLaunchCounts {
  total: number
  queued: number
  withPairingEvidence: number
  androidExecutable: number
}

export interface AndroidControlPlaneBinaryStatusCounts {
  total: number
  accepted: number
  rejected: number
}

export interface AndroidControlPlaneCountPolicyConfiguration {
  cardLimit: number
  installStatuses: readonly CountInstallStatus[]
  registeredStatuses: readonly CountRegisteredStatus[]
  createEmptyInstallPlanCounts(): ToolchainCountInstallPlanCounts
  createEmptyRegisteredCatalogCounts(): RegisteredCatalogCounts
  createEmptyRegistrySnapshotCounts(total?: number): RegistrySnapshotCounts
  installPlanCountsAreInternallyValid(counts: ToolchainCountInstallPlanCounts): boolean
  registeredCatalogCountsAreInternallyValid(counts: RegisteredCatalogCounts): boolean
  registrySnapshotCountsAreInternallyValid(counts: RegistrySnapshotCounts): boolean
}

export function createAndroidControlPlaneCountPolicy(config: AndroidControlPlaneCountPolicyConfiguration) {
  function createControlPlaneInstallCountsFromCards(
    cards: readonly AndroidControlPlaneToolCountCard[]
  ): ToolchainCountInstallPlanCounts {
    const counts = config.createEmptyInstallPlanCounts()
    counts.total = cards.length
    for (const card of cards) counts[card.status] += 1
    return counts
  }

  function createControlPlaneRegisteredCountsFromCards(
    cards: readonly AndroidControlPlaneRegisteredToolCountCard[]
  ): RegisteredCatalogCounts {
    const counts = config.createEmptyRegisteredCatalogCounts()
    counts.total = cards.length
    for (const card of cards) {
      counts[card.status] += 1
      if (card.registrationKind === 'app-action') counts.appAction += 1
      else counts.runtimeTool += 1
    }
    return counts
  }

  function createControlPlaneRegistryCountsFromCards(
    cards: readonly AndroidControlPlaneToolCountCard[]
  ): RegistrySnapshotCounts {
    const counts = config.createEmptyRegistrySnapshotCounts(cards.length)
    for (const card of cards) {
      if (card.registryStatus === 'invalid') {
        counts.invalid += 1
      } else {
        counts.valid += 1
        if (card.registryStatus === 'ready') counts.ready += 1
        else if (card.registryStatus === 'needs_permission') counts.needsPermission += 1
        else if (card.registryStatus === 'waiting_for_user') counts.waitingForUser += 1
        else if (card.registryStatus === 'unsupported') counts.unsupported += 1
      }
    }
    return counts
  }

  function createControlPlaneBinaryStatusCounts(
    cards: readonly AndroidControlPlaneBinaryStatusCard[]
  ): AndroidControlPlaneBinaryStatusCounts {
    return {
      total: cards.length,
      accepted: cards.filter((card) => card.status === 'accepted').length,
      rejected: cards.filter((card) => card.status === 'rejected').length,
    }
  }

  function createControlPlaneTaskCancelCounts(
    tasks: readonly AndroidControlPlaneTaskCancelCard[]
  ): AndroidControlPlaneTaskCancelCounts {
    const counts: AndroidControlPlaneTaskCancelCounts = {
      total: tasks.length,
      available: 0,
      blocked: 0,
      terminalTask: 0,
      runtimeMismatch: 0,
      runtimeUnavailable: 0,
      capabilityMissing: 0,
      invalidTransition: 0,
    }
    for (const task of tasks) {
      if (task.canRequestCancel) {
        counts.available += 1
        continue
      }
      counts.blocked += 1
      if (task.cancelErrorCode === 'terminal_task') counts.terminalTask += 1
      else if (task.cancelErrorCode === 'runtime_mismatch') counts.runtimeMismatch += 1
      else if (task.cancelErrorCode === 'runtime_unavailable') counts.runtimeUnavailable += 1
      else if (task.cancelErrorCode === 'capability_missing') counts.capabilityMissing += 1
      else if (task.cancelErrorCode === 'invalid_transition') counts.invalidTransition += 1
    }
    return counts
  }

  function createControlPlaneRegisteredLaunchCounts(
    launches: readonly AndroidControlPlaneRegisteredLaunchCountCard[]
  ): AndroidControlPlaneRegisteredLaunchCounts {
    return {
      total: launches.length,
      queued: launches.filter((launch) => launch.status === 'queued').length,
      withPairingEvidence: launches.filter((launch) => launch.hasRuntimePairingAcceptance).length,
      androidExecutable: launches.filter((launch) => launch.androidCanExecute).length,
    }
  }

  function buildAndroidControlPlaneEventSummary(snapshot: AndroidControlPlaneSummarySnapshot): string {
    const needsAction = snapshot.installCounts.needs_permission +
      snapshot.installCounts.needs_runtime +
      snapshot.installCounts.needs_confirmation +
      snapshot.installCounts.blocked
    const attentionTasks = snapshot.taskCards.filter((task) => task.requiresAttention).length
    const cancelableTasks = snapshot.taskCards.filter((task) => task.canRequestCancel).length
    const registeredRuntimeLaunches = snapshot.registeredLaunchCards.filter((launch) => launch.dispatchRequiresPairedRuntime).length
    const readyGateways = snapshot.gatewayCards.filter((gateway) => gateway.ready).length
    const rejectedPairings = snapshot.pairingAcceptanceCards.filter((acceptance) => acceptance.status === 'rejected').length
    const onlineRuntimes = snapshot.runtimeBadges.filter((runtime) => runtime.online).length
    return `${snapshot.installCounts.installable} installable tool(s), ${snapshot.registeredCounts.ready} registered tool(s) ready, ${needsAction} need action, ${snapshot.taskCards.length} active task(s), ${attentionTasks} task(s) need attention, ${cancelableTasks} task cancel action(s) available, ${snapshot.registeredLaunchCards.length} registered launch(es), ${registeredRuntimeLaunches} runtime launch(es), ${readyGateways} MCP gateway session(s) ready, ${snapshot.pairingAcceptanceCards.length} runtime pairing result(s), ${rejectedPairings} pairing issue(s), ${onlineRuntimes} runtime(s) online; doctor is ${snapshot.doctorStatus}.`
  }

  function controlPlaneInstallCountsEqual(left: ToolchainCountInstallPlanCounts, right: ToolchainCountInstallPlanCounts): boolean {
    return left.total === right.total && config.installStatuses.every((status) => left[status] === right[status])
  }

  function controlPlaneRegisteredCountsEqual(left: RegisteredCatalogCounts, right: RegisteredCatalogCounts): boolean {
    return left.total === right.total && left.appAction === right.appAction && left.runtimeTool === right.runtimeTool &&
      config.registeredStatuses.every((status) => left[status] === right[status])
  }

  function controlPlaneRegistryCountsEqual(left: RegistrySnapshotCounts, right: RegistrySnapshotCounts): boolean {
    return left.total === right.total && left.valid === right.valid && left.invalid === right.invalid &&
      left.ready === right.ready && left.needsPermission === right.needsPermission &&
      left.waitingForUser === right.waitingForUser && left.unsupported === right.unsupported
  }

  function controlPlaneInstallCountsCanRepresentCards(
    counts: ToolchainCountInstallPlanCounts,
    cards: readonly AndroidControlPlaneToolCountCard[]
  ): boolean {
    if (!config.installPlanCountsAreInternallyValid(counts) || counts.total < cards.length) return false
    const visibleCounts = createControlPlaneInstallCountsFromCards(cards)
    const truncated = cards.length >= config.cardLimit && counts.total > cards.length
    if (!truncated && !controlPlaneInstallCountsEqual(counts, visibleCounts)) return false
    return config.installStatuses.every((status) => counts[status] >= visibleCounts[status])
  }

  function controlPlaneRegisteredCountsCanRepresentCards(
    counts: RegisteredCatalogCounts,
    cards: readonly AndroidControlPlaneRegisteredToolCountCard[]
  ): boolean {
    if (!config.registeredCatalogCountsAreInternallyValid(counts) || counts.total < cards.length) return false
    const visibleCounts = createControlPlaneRegisteredCountsFromCards(cards)
    const truncated = cards.length >= config.cardLimit && counts.total > cards.length
    if (!truncated && !controlPlaneRegisteredCountsEqual(counts, visibleCounts)) return false
    return counts.appAction >= visibleCounts.appAction && counts.runtimeTool >= visibleCounts.runtimeTool &&
      config.registeredStatuses.every((status) => counts[status] >= visibleCounts[status])
  }

  function controlPlaneRegistryCountsCanRepresentCards(
    counts: RegistrySnapshotCounts,
    cards: readonly AndroidControlPlaneToolCountCard[]
  ): boolean {
    if (!config.registrySnapshotCountsAreInternallyValid(counts) || counts.total < cards.length) return false
    const visibleCounts = createControlPlaneRegistryCountsFromCards(cards)
    const truncated = cards.length >= config.cardLimit && counts.total > cards.length
    if (!truncated && !controlPlaneRegistryCountsEqual(counts, visibleCounts)) return false
    return counts.valid >= visibleCounts.valid && counts.invalid >= visibleCounts.invalid &&
      counts.ready >= visibleCounts.ready && counts.needsPermission >= visibleCounts.needsPermission &&
      counts.waitingForUser >= visibleCounts.waitingForUser && counts.unsupported >= visibleCounts.unsupported
  }

  function recordCountsEqual<T extends object>(left: T, right: T, keys: readonly (keyof T)[]): boolean {
    return isRecord(left) && keys.every((key) => left[key] === right[key])
  }

  const createControlPlanePairingAcceptanceCounts = createControlPlaneBinaryStatusCounts
  const controlPlaneRegisteredLaunchCountsEqual = (left: AndroidControlPlaneRegisteredLaunchCounts, right: AndroidControlPlaneRegisteredLaunchCounts) =>
    recordCountsEqual(left, right, ['total', 'queued', 'withPairingEvidence', 'androidExecutable'])
  const controlPlaneTaskCancelCountsEqual = (left: AndroidControlPlaneTaskCancelCounts, right: AndroidControlPlaneTaskCancelCounts) =>
    recordCountsEqual(left, right, ['total', 'available', 'blocked', 'terminalTask', 'runtimeMismatch', 'runtimeUnavailable', 'capabilityMissing', 'invalidTransition'])
  const controlPlanePairingAcceptanceCountsEqual = (left: AndroidControlPlaneBinaryStatusCounts, right: AndroidControlPlaneBinaryStatusCounts) =>
    recordCountsEqual(left, right, ['total', 'accepted', 'rejected'])

  return {
    buildAndroidControlPlaneEventSummary,
    controlPlaneInstallCountsCanRepresentCards,
    controlPlanePairingAcceptanceCountsEqual,
    controlPlaneRegisteredCountsCanRepresentCards,
    controlPlaneRegisteredLaunchCountsEqual,
    controlPlaneRegistryCountsCanRepresentCards,
    controlPlaneTaskCancelCountsEqual,
    createControlPlaneInstallCountsFromCards,
    createControlPlanePairingAcceptanceCounts,
    createControlPlaneRegisteredCountsFromCards,
    createControlPlaneRegisteredLaunchCounts,
    createControlPlaneRegistryCountsFromCards,
    createControlPlaneTaskCancelCounts,
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}
