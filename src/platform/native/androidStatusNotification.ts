export type AndroidStatusNotificationState = 'generating' | 'running' | 'error' | 'completed'

export interface AndroidStatusNotificationPayload {
  state: AndroidStatusNotificationState
  title: string
  message: string
  shortText?: string
  conversationId?: string
  deepLink?: string
  progress?: number
  indeterminate?: boolean
  ongoing?: boolean
  requestPromotedOngoing?: boolean
  foregroundService?: boolean
}

export interface AndroidStatusNotificationUpdateOptions {
  enabled?: boolean
  /** Logical owner of the shared status notification slot. */
  owner?: string
}

export interface AndroidStatusNotificationClearOptions {
  /** Only clear when this owner still owns the shared status notification slot. */
  owner?: string
}

export interface AndroidStatusNotificationPermissionRationale {
  title: string
  message: string
  buttonPositive: string
  buttonNegative: string
}

export interface AndroidStatusNotificationPermissionStatus {
  available: boolean
  granted: boolean
  backgroundReliable: boolean
  androidApiLevel?: number
  promotedNotificationsAvailable?: boolean
  canPostPromotedNotifications?: boolean | null
  reason?: 'unavailable' | 'native_error' | string
  errorMessage?: string
}

export interface AndroidStatusNotificationResult {
  shown: boolean
  reason: 'shown' | 'cleared' | 'disabled' | 'unavailable' | 'permission_denied' | string
  backgroundReliable: boolean
  foregroundServiceStarted?: boolean
  promotedOngoingRequested?: boolean
  promotedNotificationState?: 'not_requested' | 'unsupported_api' | 'requested' | 'blocked' | string
  canPostPromotedNotifications?: boolean | null
  errorMessage?: string
}

export type AndroidStatusNotificationSettingsTarget = 'notifications' | 'promoted'

export interface AndroidStatusNotificationSettingsResult {
  opened: boolean
  target: AndroidStatusNotificationSettingsTarget
  reason: 'opened' | 'unavailable' | 'unsupported_api' | 'failed'
  errorMessage?: string
}

export interface AndroidStatusNotificationPort {
  isAvailable(): boolean
  getPermissionStatus(): Promise<AndroidStatusNotificationPermissionStatus>
  requestPermission(rationale: AndroidStatusNotificationPermissionRationale): Promise<AndroidStatusNotificationPermissionStatus>
  update(payload: AndroidStatusNotificationPayload, options?: AndroidStatusNotificationUpdateOptions): Promise<AndroidStatusNotificationResult>
  clear(options?: AndroidStatusNotificationClearOptions): Promise<AndroidStatusNotificationResult>
  openSettings(target?: AndroidStatusNotificationSettingsTarget): Promise<AndroidStatusNotificationSettingsResult>
}

export interface AndroidStatusNotificationNativeModule {
  getPermissionStatus: () => Promise<unknown>
  updateStatus: (payload: AndroidStatusNotificationPayload) => Promise<unknown>
  clearStatus: () => Promise<unknown>
}

export interface AndroidStatusNotificationAdapterDependencies {
  platform: {
    os: string
    version: number | string
  }
  nativeModule?: AndroidStatusNotificationNativeModule
  postNotificationsPermission: string
  grantedPermissionResult: string
  requestPermission?: (
    permission: string,
    rationale: AndroidStatusNotificationPermissionRationale,
  ) => Promise<string>
  applicationId?: string | null
  startActivity: (
    action: string,
    params?: { data?: string, extra?: Record<string, unknown> },
  ) => Promise<unknown>
}

const APP_NOTIFICATION_SETTINGS_ACTION = 'android.settings.APP_NOTIFICATION_SETTINGS'
const APP_NOTIFICATION_PROMOTION_SETTINGS_ACTION = 'android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS'
const APP_DETAILS_SETTINGS_ACTION = 'android.settings.APPLICATION_DETAILS_SETTINGS'
const NOTIFICATION_SETTINGS_ACTION = 'android.settings.NOTIFICATION_SETTINGS'
const EXTRA_APP_PACKAGE = 'android.provider.extra.APP_PACKAGE'
const NATIVE_RESULT_TEXT_LIMIT = 512

export function createExpoAndroidStatusNotificationPort(
  dependencies?: AndroidStatusNotificationAdapterDependencies,
): AndroidStatusNotificationPort {
  let resolvedDependencies = dependencies
  let lastMutationKey: string | null = null
  let mutationTail: Promise<void> = Promise.resolve()
  let activeOwner: string | null = null
  const resolveDependencies = () => {
    resolvedDependencies ??= loadDefaultDependencies()
    return resolvedDependencies
  }

  const isAvailable = () => {
    const runtime = resolveDependencies()
    return runtime.platform.os === 'android' && Boolean(runtime.nativeModule)
  }

  const getPermissionStatus = async (): Promise<AndroidStatusNotificationPermissionStatus> => {
    const runtime = resolveDependencies()
    if (!isRuntimeAvailable(runtime) || !runtime.nativeModule) {
      return permissionStatusFallback(runtime, false, 'unavailable')
    }
    try {
      return normalizeNativePermissionStatus(await runtime.nativeModule.getPermissionStatus())
    } catch (error) {
      return permissionStatusFallback(runtime, true, 'native_error', error)
    }
  }

  const updateRaw = async (
    payload: AndroidStatusNotificationPayload,
    options: AndroidStatusNotificationUpdateOptions = {},
  ): Promise<AndroidStatusNotificationResult> => {
    const runtime = resolveDependencies()
    if (!isRuntimeAvailable(runtime) || !runtime.nativeModule) return unavailableStatusResult()
    if (options.enabled !== true) {
      return { shown: false, reason: 'disabled', backgroundReliable: false }
    }
    const permission = await getPermissionStatus()
    if (!permission.granted) {
      return {
        shown: false,
        reason: permission.reason ?? 'permission_denied',
        backgroundReliable: false,
        errorMessage: permission.errorMessage,
      }
    }
    return safeNativeStatusCall(() => runtime.nativeModule!.updateStatus(payload))
  }

  const clearRaw = async (options: AndroidStatusNotificationClearOptions = {}): Promise<AndroidStatusNotificationResult> => {
    const runtime = resolveDependencies()
    if (!isRuntimeAvailable(runtime) || !runtime.nativeModule) return unavailableStatusResult()
    const owner = normalizeOwner(options.owner)
    if (owner && activeOwner !== owner) {
      return { shown: false, reason: 'superseded', backgroundReliable: false }
    }
    return safeNativeStatusCall(() => runtime.nativeModule!.clearStatus())
  }

  const dispatchMutation = (
    mutationKey: string,
    operation: () => Promise<AndroidStatusNotificationResult>,
  ): Promise<AndroidStatusNotificationResult> => {
    if (mutationKey === lastMutationKey) {
      return Promise.resolve({ shown: false, reason: 'deduplicated', backgroundReliable: false })
    }
    lastMutationKey = mutationKey
    const execute = async () => {
      const result = await operation()
      // A denied/unavailable update should be eligible for a later retry.
      if (!result.shown && result.reason !== 'cleared' && lastMutationKey === mutationKey) lastMutationKey = null
      return result
    }
    const result = mutationTail.then(execute, execute)
    const guardedResult = result.catch((error: unknown) => {
      if (lastMutationKey === mutationKey) lastMutationKey = null
      throw error
    })
    mutationTail = guardedResult.then(() => undefined, () => undefined)
    return guardedResult
  }

  return {
    isAvailable,
    getPermissionStatus,
    async requestPermission(rationale) {
      const runtime = resolveDependencies()
      if (!isRuntimeAvailable(runtime)) {
        return permissionStatusFallback(runtime, false, 'unavailable')
      }
      const apiLevel = androidApiLevel(runtime)
      if (apiLevel < 33) return getPermissionStatus()
      try {
        const result = runtime.requestPermission
          ? await runtime.requestPermission(runtime.postNotificationsPermission, rationale)
          : undefined
        return {
          available: true,
          granted: result === runtime.grantedPermissionResult,
          backgroundReliable: false,
          androidApiLevel: apiLevel,
        }
      } catch (error) {
        return permissionStatusFallback(runtime, true, 'native_error', error, apiLevel)
      }
    },
    update(payload, options = {}) {
      if (options.enabled !== true) return updateRaw(payload, options)
      const owner = normalizeOwner(options.owner)
      return dispatchMutation(`${owner}\u001f${buildAndroidStatusNotificationMutationKey(payload)}`, async () => {
        const result = await updateRaw(payload, options)
        if (result.shown) activeOwner = owner
        return result
      })
    },
    clear(options = {}) {
      const owner = normalizeOwner(options.owner)
      const mutationKey = `clear\u001f${owner ?? '*'}`
      return dispatchMutation(mutationKey, async () => {
        const result = await clearRaw(options)
        if (result.reason === 'cleared') activeOwner = null
        return result
      })
    },
    async openSettings(target = 'notifications') {
      const runtime = resolveDependencies()
      if (runtime.platform.os !== 'android') return { opened: false, target, reason: 'unavailable' }
      if (target === 'promoted' && androidApiLevel(runtime) < 36) {
        return { opened: false, target, reason: 'unsupported_api' }
      }

      const appPackage = runtime.applicationId
      const packageParams = appPackage ? { extra: { [EXTRA_APP_PACKAGE]: appPackage } } : undefined
      const primaryAction = target === 'promoted'
        ? APP_NOTIFICATION_PROMOTION_SETTINGS_ACTION
        : APP_NOTIFICATION_SETTINGS_ACTION
      const primaryError = await tryStartAndroidSettings(runtime, primaryAction, packageParams)
      if (!primaryError) return { opened: true, target, reason: 'opened' }

      if (target === 'promoted') {
        const notificationError = await tryStartAndroidSettings(runtime, APP_NOTIFICATION_SETTINGS_ACTION, packageParams)
        if (!notificationError) return { opened: true, target, reason: 'opened' }
      }

      const fallbackError = appPackage
        ? await tryStartAndroidSettings(runtime, APP_DETAILS_SETTINGS_ACTION, { data: `package:${appPackage}` })
        : await tryStartAndroidSettings(runtime, NOTIFICATION_SETTINGS_ACTION)
      if (!fallbackError) return { opened: true, target, reason: 'opened' }
      return {
        opened: false,
        target,
        reason: 'failed',
        errorMessage: errorMessageFrom(fallbackError ?? primaryError),
      }
    },
  }
}

function normalizeOwner(owner: string | undefined): string | null {
  const normalized = owner?.trim()
  return normalized ? normalized : null
}

/** Includes every user-visible field so equivalent updates cross the native bridge once. */
export function buildAndroidStatusNotificationMutationKey(payload: AndroidStatusNotificationPayload): string {
  return JSON.stringify([
    payload.state,
    payload.title,
    payload.message,
    payload.shortText ?? null,
    payload.conversationId ?? null,
    payload.deepLink ?? null,
    payload.progress ?? null,
    payload.indeterminate ?? null,
    payload.ongoing ?? null,
    payload.requestPromotedOngoing ?? null,
    payload.foregroundService ?? null,
  ])
}

function loadDefaultDependencies(): AndroidStatusNotificationAdapterDependencies {
  const reactNative = require('react-native') as {
    NativeModules?: Record<string, unknown>
    Platform?: { OS?: string, Version?: number | string }
    PermissionsAndroid?: {
      PERMISSIONS?: { POST_NOTIFICATIONS?: string }
      RESULTS?: { GRANTED?: string }
      request?: (permission: string, rationale: AndroidStatusNotificationPermissionRationale) => Promise<string>
    }
  }
  const applicationLoaded = loadOptionalExpoApplication()
  const application = applicationLoaded?.default ?? applicationLoaded
  const permissions = reactNative.PermissionsAndroid
  return {
    platform: {
      os: reactNative.Platform?.OS ?? 'unknown',
      version: reactNative.Platform?.Version ?? 0,
    },
    nativeModule: reactNative.NativeModules?.AndroidStatusNotification as AndroidStatusNotificationNativeModule | undefined,
    postNotificationsPermission: permissions?.PERMISSIONS?.POST_NOTIFICATIONS ?? 'android.permission.POST_NOTIFICATIONS',
    grantedPermissionResult: permissions?.RESULTS?.GRANTED ?? 'granted',
    requestPermission: permissions?.request?.bind(permissions),
    applicationId: application?.applicationId,
    startActivity: createLazyAndroidNotificationSettingsLauncher(),
  }
}

function createLazyAndroidNotificationSettingsLauncher(): AndroidStatusNotificationAdapterDependencies['startActivity'] {
  let resolved: AndroidStatusNotificationAdapterDependencies['startActivity'] | null = null
  let attempted = false
  return async (action, params) => {
    if (!attempted) {
      attempted = true
      const intentLoaded = loadOptionalExpoIntentLauncher()
      const intentLauncher = intentLoaded?.default ?? intentLoaded
      const startActivity = intentLauncher?.startActivityAsync
      if (typeof startActivity === 'function') resolved = startActivity.bind(intentLauncher)
    }
    if (!resolved) return unavailableAndroidNotificationSettingsLauncher()
    return resolved(action, params)
  }
}

function loadOptionalExpoApplication(): {
  applicationId?: string | null
  default?: { applicationId?: string | null }
} | undefined {
  try {
    return require('expo-application') as {
      applicationId?: string | null
      default?: { applicationId?: string | null }
    }
  } catch {
    return undefined
  }
}

function loadOptionalExpoIntentLauncher(): {
  startActivityAsync?: AndroidStatusNotificationAdapterDependencies['startActivity']
  default?: { startActivityAsync?: AndroidStatusNotificationAdapterDependencies['startActivity'] }
} | undefined {
  try {
    return require('expo-intent-launcher') as {
      startActivityAsync?: AndroidStatusNotificationAdapterDependencies['startActivity']
      default?: { startActivityAsync?: AndroidStatusNotificationAdapterDependencies['startActivity'] }
    }
  } catch {
    return undefined
  }
}

async function unavailableAndroidNotificationSettingsLauncher(): Promise<never> {
  throw new Error('Android notification settings launcher is unavailable.')
}

function isRuntimeAvailable(runtime: AndroidStatusNotificationAdapterDependencies): boolean {
  return runtime.platform.os === 'android' && Boolean(runtime.nativeModule)
}

function androidApiLevel(runtime: AndroidStatusNotificationAdapterDependencies): number {
  if (typeof runtime.platform.version === 'number') return runtime.platform.version
  const parsed = Number.parseInt(String(runtime.platform.version), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function unavailableStatusResult(): AndroidStatusNotificationResult {
  return { shown: false, reason: 'unavailable', backgroundReliable: false }
}

async function safeNativeStatusCall(
  action: () => Promise<unknown>,
): Promise<AndroidStatusNotificationResult> {
  try {
    return normalizeNativeStatusResult(await action())
  } catch (error) {
    return {
      shown: false,
      reason: 'native_error',
      backgroundReliable: false,
      errorMessage: errorMessageFrom(error),
    }
  }
}

function normalizeNativePermissionStatus(value: unknown): AndroidStatusNotificationPermissionStatus {
  const result = nativeResultRecord(value, 'permission status')
  const available = requiredNativeBoolean(result, 'available', 'permission status')
  const granted = requiredNativeBoolean(result, 'granted', 'permission status')
  const backgroundReliable = requiredNativeBoolean(result, 'backgroundReliable', 'permission status')
  if ((!available && granted) || backgroundReliable) {
    throw invalidNativeResult('permission status')
  }

  const androidApiLevel = optionalNativeNumber(result, 'androidApiLevel', 'permission status')
  const promotedNotificationsAvailable = optionalNativeBoolean(result, 'promotedNotificationsAvailable', 'permission status')
  const canPostPromotedNotifications = optionalNativeNullableBoolean(result, 'canPostPromotedNotifications', 'permission status')
  const reason = optionalNativeString(result, 'reason', 'permission status')
  const errorMessage = optionalNativeString(result, 'errorMessage', 'permission status')
  return {
    available,
    granted,
    backgroundReliable: false,
    ...(androidApiLevel !== undefined ? { androidApiLevel } : {}),
    ...(promotedNotificationsAvailable !== undefined ? { promotedNotificationsAvailable } : {}),
    ...(canPostPromotedNotifications !== undefined ? { canPostPromotedNotifications } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  }
}

function normalizeNativeStatusResult(value: unknown): AndroidStatusNotificationResult {
  const result = nativeResultRecord(value, 'status result')
  const shown = requiredNativeBoolean(result, 'shown', 'status result')
  const reason = requiredNativeString(result, 'reason', 'status result')
  const backgroundReliable = requiredNativeBoolean(result, 'backgroundReliable', 'status result')
  const foregroundServiceStarted = optionalNativeBoolean(result, 'foregroundServiceStarted', 'status result')
  if (backgroundReliable && foregroundServiceStarted !== true) throw invalidNativeResult('status result')

  const promotedOngoingRequested = optionalNativeBoolean(result, 'promotedOngoingRequested', 'status result')
  const promotedNotificationState = optionalNativeString(result, 'promotedNotificationState', 'status result')
  const canPostPromotedNotifications = optionalNativeNullableBoolean(result, 'canPostPromotedNotifications', 'status result')
  const errorMessage = optionalNativeString(result, 'errorMessage', 'status result')
  return {
    shown,
    reason,
    backgroundReliable,
    ...(foregroundServiceStarted !== undefined ? { foregroundServiceStarted } : {}),
    ...(promotedOngoingRequested !== undefined ? { promotedOngoingRequested } : {}),
    ...(promotedNotificationState !== undefined ? { promotedNotificationState } : {}),
    ...(canPostPromotedNotifications !== undefined ? { canPostPromotedNotifications } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  }
}

function nativeResultRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidNativeResult(label)
  return value as Record<string, unknown>
}

function requiredNativeBoolean(result: Record<string, unknown>, key: string, label: string): boolean {
  const value = result[key]
  if (typeof value !== 'boolean') throw invalidNativeResult(label)
  return value
}

function optionalNativeBoolean(result: Record<string, unknown>, key: string, label: string): boolean | undefined {
  const value = result[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw invalidNativeResult(label)
  return value
}

function optionalNativeNullableBoolean(
  result: Record<string, unknown>,
  key: string,
  label: string,
): boolean | null | undefined {
  const value = result[key]
  if (value === undefined || value === null) return value
  if (typeof value !== 'boolean') throw invalidNativeResult(label)
  return value
}

function requiredNativeString(result: Record<string, unknown>, key: string, label: string): string {
  const value = optionalNativeString(result, key, label)
  if (value === undefined || value.length === 0) throw invalidNativeResult(label)
  return value
}

function optionalNativeString(result: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = result[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalidNativeResult(label)
  return value.slice(0, NATIVE_RESULT_TEXT_LIMIT)
}

function optionalNativeNumber(result: Record<string, unknown>, key: string, label: string): number | undefined {
  const value = result[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalidNativeResult(label)
  return value
}

function invalidNativeResult(label: string): Error {
  return new Error(`Android status notification native ${label} is invalid.`)
}

async function tryStartAndroidSettings(
  runtime: AndroidStatusNotificationAdapterDependencies,
  action: string,
  params?: { data?: string, extra?: Record<string, unknown> },
): Promise<unknown | null> {
  try {
    await runtime.startActivity(action, params)
    return null
  } catch (error) {
    return error
  }
}

function permissionStatusFallback(
  runtime: AndroidStatusNotificationAdapterDependencies,
  available: boolean,
  reason: AndroidStatusNotificationPermissionStatus['reason'],
  error?: unknown,
  apiLevel = androidApiLevel(runtime),
): AndroidStatusNotificationPermissionStatus {
  return {
    available,
    granted: false,
    backgroundReliable: false,
    androidApiLevel: apiLevel,
    promotedNotificationsAvailable: apiLevel >= 36,
    canPostPromotedNotifications: null,
    reason,
    errorMessage: error ? errorMessageFrom(error) : undefined,
  }
}

function errorMessageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
