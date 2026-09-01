/**
 * Pure Android integration policy.
 *
 * The app is Expo/React Native, so this module deliberately contains no
 * platform imports or side effects.  Hooks and native adapters can use the
 * decisions here while remaining easy to exercise on the host test runner.
 */
export const ANDROID_COMPATIBILITY_POLICY_SCHEMA = 'islemind.android-compatibility-policy.v1' as const
export const ANDROID_MIN_TOUCH_TARGET_DP = 44

export type AndroidLifecycleState = 'active' | 'inactive' | 'background' | 'unknown'
export type AndroidNetworkState = 'online' | 'offline' | 'unknown'

export interface AndroidSafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface AndroidViewportPolicyInput {
  width: number
  height: number
  safeArea?: Partial<AndroidSafeAreaInsets>
  keyboardHeight?: number
  baselineWindowHeight?: number
  itemCount?: number
  blurRequested?: boolean
  blurLayerCount?: number
  lowMemory?: boolean
}

export interface AndroidViewportPolicy {
  schema: typeof ANDROID_COMPATIBILITY_POLICY_SCHEMA
  width: number
  height: number
  safeArea: AndroidSafeAreaInsets
  keyboardVisible: boolean
  keyboardLift: number
  usableHeight: number
  compact: boolean
  touchTargetMinDp: number
  list: {
    virtualized: boolean
    removeClippedSubviews: boolean
    windowSize: number
    maxToRenderPerBatch: number
  }
  blur: {
    enabled: boolean
    reason: 'not-requested' | 'bounded' | 'low-memory' | 'too-many-layers'
  }
}

export interface AndroidBackActionInput {
  workspaceReviewOpen?: boolean
  showOptions?: boolean
  composerPanelOpen?: boolean
  intentDraftPresent?: boolean
  keyboardVisible?: boolean
  canNavigateUp?: boolean
}

export type AndroidBackAction =
  | 'close-workspace-review'
  | 'close-options'
  | 'close-composer-panel'
  | 'restore-intent-draft'
  | 'dismiss-keyboard'
  | 'navigate-up'
  | 'exit'

export interface AndroidBackActionPlan {
  action: AndroidBackAction
  handled: boolean
}

export interface AndroidLifecyclePolicyInput {
  previousState: AndroidLifecycleState
  nextState: AndroidLifecycleState
  streamActive?: boolean
  draftPresent?: boolean
}

export interface AndroidLifecyclePolicy {
  preserveDraft: boolean
  preserveStreamIdentity: boolean
  suspendBackgroundWork: boolean
  recoverOnResume: boolean
  avoidAutomaticReplay: boolean
}

export interface AndroidNetworkRecoveryInput {
  previousState: AndroidNetworkState
  nextState: AndroidNetworkState
  requestInFlight?: boolean
  streamStarted?: boolean
}

export interface AndroidNetworkRecoveryPolicy {
  state: AndroidNetworkState
  showOfflineState: boolean
  retryAdmitted: boolean
  preserveRequestIdentity: boolean
  reason: 'offline' | 'recovered' | 'online' | 'unknown'
}

export function resolveAndroidViewportPolicy(
  input: AndroidViewportPolicyInput,
): AndroidViewportPolicy {
  const width = normalizeExtent(input.width, 320)
  const height = normalizeExtent(input.height, 568)
  const safeArea = normalizeInsets(input.safeArea)
  const keyboardHeight = normalizeNonNegative(input.keyboardHeight)
  const baselineWindowHeight = normalizeExtent(input.baselineWindowHeight, height)
  const keyboardLift = resolveAndroidKeyboardLift({
    keyboardHeight,
    baselineWindowHeight,
    windowHeight: height,
  })
  const usableHeight = Math.max(1, height - safeArea.top - safeArea.bottom - keyboardLift)
  const itemCount = normalizeCount(input.itemCount)
  const compact = width < 380 || usableHeight < 480
  const blurLayerCount = normalizeCount(input.blurLayerCount)
  const blurRequested = input.blurRequested === true
  const blurReason = !blurRequested
    ? 'not-requested'
    : input.lowMemory === true
      ? 'low-memory'
      : blurLayerCount > 2
        ? 'too-many-layers'
        : 'bounded'

  return {
    schema: ANDROID_COMPATIBILITY_POLICY_SCHEMA,
    width,
    height,
    safeArea,
    keyboardVisible: keyboardHeight > 0 || keyboardLift > 0,
    keyboardLift,
    usableHeight,
    compact,
    touchTargetMinDp: ANDROID_MIN_TOUCH_TARGET_DP,
    list: {
      virtualized: true,
      removeClippedSubviews: itemCount > 40,
      windowSize: compact ? 7 : 9,
      maxToRenderPerBatch: compact ? 8 : 12,
    },
    blur: {
      enabled: blurReason === 'bounded',
      reason: blurReason,
    },
  }
}

export function resolveAndroidKeyboardLift(input: {
  keyboardHeight: number
  baselineWindowHeight: number
  windowHeight: number
}): number {
  const keyboardHeight = normalizeNonNegative(input.keyboardHeight)
  const baselineWindowHeight = normalizeExtent(input.baselineWindowHeight, input.windowHeight)
  const windowHeight = normalizeExtent(input.windowHeight, baselineWindowHeight)
  const resizeInset = keyboardHeight > 0
    ? Math.max(0, baselineWindowHeight - windowHeight)
    : 0
  return Math.max(0, keyboardHeight - resizeInset)
}

/** Resolve Android hardware-back behavior from most local overlay to exit. */
export function resolveAndroidBackAction(
  input: AndroidBackActionInput,
): AndroidBackActionPlan {
  if (input.workspaceReviewOpen) return { action: 'close-workspace-review', handled: true }
  if (input.showOptions) return { action: 'close-options', handled: true }
  if (input.composerPanelOpen) return { action: 'close-composer-panel', handled: true }
  if (input.intentDraftPresent) return { action: 'restore-intent-draft', handled: true }
  if (input.keyboardVisible) return { action: 'dismiss-keyboard', handled: true }
  if (input.canNavigateUp) return { action: 'navigate-up', handled: true }
  return { action: 'exit', handled: false }
}

/**
 * Lifecycle decisions intentionally preserve identity and drafts.  A resume
 * can trigger stale-state recovery, but it never authorizes replaying a
 * provider request or a side effect.
 */
export function resolveAndroidLifecyclePolicy(
  input: AndroidLifecyclePolicyInput,
): AndroidLifecyclePolicy {
  const leavingActive = input.nextState !== 'active'
  const returningToActive = input.nextState === 'active' && input.previousState !== 'active'
  return {
    preserveDraft: input.draftPresent === true || leavingActive,
    preserveStreamIdentity: input.streamActive === true,
    suspendBackgroundWork: leavingActive,
    recoverOnResume: returningToActive,
    avoidAutomaticReplay: true,
  }
}

/**
 * Network recovery is admission-only: it tells the caller when a retry may be
 * offered, while keeping the original request identity so a UI resume cannot
 * silently duplicate a successful stream.
 */
export function resolveAndroidNetworkRecovery(
  input: AndroidNetworkRecoveryInput,
): AndroidNetworkRecoveryPolicy {
  const nextState = input.nextState
  if (nextState === 'offline') {
    return {
      state: 'offline',
      showOfflineState: true,
      retryAdmitted: false,
      preserveRequestIdentity: input.requestInFlight === true || input.streamStarted === true,
      reason: 'offline',
    }
  }
  if (nextState === 'online' && input.previousState === 'offline') {
    return {
      state: 'online',
      showOfflineState: false,
      retryAdmitted: input.requestInFlight !== true && input.streamStarted !== true,
      preserveRequestIdentity: true,
      reason: 'recovered',
    }
  }
  return {
    state: nextState,
    showOfflineState: nextState === 'unknown',
    retryAdmitted: false,
    preserveRequestIdentity: input.requestInFlight === true || input.streamStarted === true,
    reason: nextState === 'online' ? 'online' : 'unknown',
  }
}

function normalizeInsets(value: Partial<AndroidSafeAreaInsets> | undefined): AndroidSafeAreaInsets {
  return {
    top: normalizeNonNegative(value?.top),
    right: normalizeNonNegative(value?.right),
    bottom: normalizeNonNegative(value?.bottom),
    left: normalizeNonNegative(value?.left),
  }
}

function normalizeExtent(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return fallback
  return Math.max(1, Math.round(value ?? fallback))
}

function normalizeNonNegative(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return 0
  return Math.round(value ?? 0)
}

function normalizeCount(value: number | undefined): number {
  return Math.max(0, Math.min(100_000, Math.round(normalizeNonNegative(value))))
}
