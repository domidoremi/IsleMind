import {
  ANDROID_MIN_TOUCH_TARGET_DP,
  resolveAndroidBackAction,
  resolveAndroidLifecyclePolicy,
  resolveAndroidNetworkRecovery,
  resolveAndroidViewportPolicy,
} from './androidCompatibilityPolicy'

describe('Android compatibility policy', () => {
  it('accounts for resize-mode keyboard insets and safe areas', () => {
    const policy = resolveAndroidViewportPolicy({
      width: 360,
      height: 560,
      baselineWindowHeight: 800,
      keyboardHeight: 320,
      safeArea: { top: 24, bottom: 16 },
      itemCount: 120,
      blurRequested: true,
    })
    expect(policy.keyboardLift).toBe(80)
    expect(policy.usableHeight).toBe(440)
    expect(policy.compact).toBe(true)
    expect(policy.list.removeClippedSubviews).toBe(true)
    expect(policy.touchTargetMinDp).toBe(ANDROID_MIN_TOUCH_TARGET_DP)
  })

  it('resolves hardware back from the nearest overlay outward', () => {
    expect(resolveAndroidBackAction({
      workspaceReviewOpen: true,
      showOptions: true,
      keyboardVisible: true,
    })).toEqual({ action: 'close-workspace-review', handled: true })
    expect(resolveAndroidBackAction({ keyboardVisible: true })).toEqual({ action: 'dismiss-keyboard', handled: true })
    expect(resolveAndroidBackAction({ canNavigateUp: true })).toEqual({ action: 'navigate-up', handled: true })
    expect(resolveAndroidBackAction({})).toEqual({ action: 'exit', handled: false })
  })

  it('recovers stale state on resume without replaying an in-flight request', () => {
    expect(resolveAndroidLifecyclePolicy({
      previousState: 'background',
      nextState: 'active',
      streamActive: true,
      draftPresent: true,
    })).toEqual({
      preserveDraft: true,
      preserveStreamIdentity: true,
      suspendBackgroundWork: false,
      recoverOnResume: true,
      avoidAutomaticReplay: true,
    })
  })

  it('keeps offline recovery explicit and bounded', () => {
    expect(resolveAndroidNetworkRecovery({
      previousState: 'offline',
      nextState: 'online',
      requestInFlight: false,
      streamStarted: false,
    })).toMatchObject({
      reason: 'recovered',
      retryAdmitted: true,
      preserveRequestIdentity: true,
    })
    expect(resolveAndroidNetworkRecovery({
      previousState: 'offline',
      nextState: 'online',
      requestInFlight: true,
    }).retryAdmitted).toBe(false)
  })
})
