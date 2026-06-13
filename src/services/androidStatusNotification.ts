import { NativeModules, PermissionsAndroid, Platform } from 'react-native'
import * as Application from 'expo-application'
import * as IntentLauncher from 'expo-intent-launcher'
import { useSettingsStore } from '@/store/settingsStore'

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
}

interface AndroidStatusNotificationModule {
  getPermissionStatus: () => Promise<AndroidStatusNotificationPermissionStatus>
  updateStatus: (payload: AndroidStatusNotificationPayload) => Promise<AndroidStatusNotificationResult>
  clearStatus: () => Promise<AndroidStatusNotificationResult>
}

export interface AndroidStatusNotificationPermissionStatus {
  available: boolean
  granted: boolean
  backgroundReliable: false
  androidApiLevel?: number
  promotedNotificationsAvailable?: boolean
  canPostPromotedNotifications?: boolean | null
  reason?: 'unavailable' | 'native_error' | string
  errorMessage?: string
}

export interface AndroidStatusNotificationResult {
  shown: boolean
  reason: 'shown' | 'cleared' | 'disabled' | 'unavailable' | 'permission_denied' | string
  backgroundReliable: false
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

const nativeModule = NativeModules.AndroidStatusNotification as AndroidStatusNotificationModule | undefined
const postNotificationsPermission = PermissionsAndroid?.PERMISSIONS?.POST_NOTIFICATIONS ?? 'android.permission.POST_NOTIFICATIONS'
const appNotificationSettingsAction = 'android.settings.APP_NOTIFICATION_SETTINGS'
const appNotificationPromotionSettingsAction = 'android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS'
const appDetailsSettingsAction = 'android.settings.APPLICATION_DETAILS_SETTINGS'
const notificationSettingsAction = 'android.settings.NOTIFICATION_SETTINGS'
const extraAppPackage = 'android.provider.extra.APP_PACKAGE'

export function androidStatusNotificationsAvailable(): boolean {
  return Platform.OS === 'android' && !!nativeModule
}

export async function getAndroidStatusNotificationPermissionStatus(): Promise<AndroidStatusNotificationPermissionStatus> {
  if (!androidStatusNotificationsAvailable() || !nativeModule) {
    return permissionStatusFallback(false, 'unavailable')
  }

  try {
    return {
      ...(await nativeModule.getPermissionStatus()),
      backgroundReliable: false,
    }
  } catch (error) {
    return permissionStatusFallback(true, 'native_error', error)
  }
}

export async function requestAndroidStatusNotificationPermission(rationale: {
  title: string
  message: string
  buttonPositive: string
  buttonNegative: string
}): Promise<AndroidStatusNotificationPermissionStatus> {
  if (!androidStatusNotificationsAvailable()) {
    return permissionStatusFallback(false, 'unavailable')
  }

  const apiLevel = androidApiLevel()
  if (apiLevel >= 33) {
    try {
      const result = await PermissionsAndroid?.request(postNotificationsPermission, rationale)
      return {
        available: true,
        granted: result === PermissionsAndroid?.RESULTS?.GRANTED,
        backgroundReliable: false,
        androidApiLevel: apiLevel,
      }
    } catch (error) {
      return permissionStatusFallback(true, 'native_error', error, apiLevel)
    }
  }

  return getAndroidStatusNotificationPermissionStatus()
}

export async function updateAndroidStatusNotification(payload: AndroidStatusNotificationPayload): Promise<AndroidStatusNotificationResult> {
  if (!androidStatusNotificationsAvailable() || !nativeModule) return { shown: false, reason: 'unavailable', backgroundReliable: false }
  if (useSettingsStore.getState().settings.systemStatusNotificationsEnabled !== true) return { shown: false, reason: 'disabled', backgroundReliable: false }

  const permission = await getAndroidStatusNotificationPermissionStatus()
  if (!permission.granted) {
    return {
      shown: false,
      reason: permission.reason ?? 'permission_denied',
      backgroundReliable: false,
      errorMessage: permission.errorMessage,
    }
  }

  return safeNativeStatusCall(() => nativeModule.updateStatus(payload))
}

export async function clearAndroidStatusNotification(): Promise<AndroidStatusNotificationResult> {
  if (!androidStatusNotificationsAvailable() || !nativeModule) return { shown: false, reason: 'unavailable', backgroundReliable: false }
  return safeNativeStatusCall(() => nativeModule.clearStatus())
}

export async function openAndroidStatusNotificationSettings(
  target: AndroidStatusNotificationSettingsTarget = 'notifications'
): Promise<AndroidStatusNotificationSettingsResult> {
  if (Platform.OS !== 'android') return { opened: false, target, reason: 'unavailable' }
  if (target === 'promoted' && androidApiLevel() < 36) return { opened: false, target, reason: 'unsupported_api' }

  const appPackage = Application.applicationId
  const primaryAction = target === 'promoted' ? appNotificationPromotionSettingsAction : appNotificationSettingsAction
  const primaryError = await tryStartAndroidSettings(primaryAction, appPackage ? { extra: { [extraAppPackage]: appPackage } } : undefined)
  if (!primaryError) return { opened: true, target, reason: 'opened' }

  if (target === 'promoted') {
    const notificationError = await tryStartAndroidSettings(appNotificationSettingsAction, appPackage ? { extra: { [extraAppPackage]: appPackage } } : undefined)
    if (!notificationError) return { opened: true, target, reason: 'opened' }
  }

  const fallbackError = appPackage
    ? await tryStartAndroidSettings(appDetailsSettingsAction, { data: `package:${appPackage}` })
    : await tryStartAndroidSettings(notificationSettingsAction)

  if (!fallbackError) return { opened: true, target, reason: 'opened' }
  return { opened: false, target, reason: 'failed', errorMessage: errorMessageFrom(fallbackError ?? primaryError) }
}

function androidApiLevel(): number {
  const value = Platform.Version
  if (typeof value === 'number') return value
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

async function safeNativeStatusCall(action: () => Promise<AndroidStatusNotificationResult>): Promise<AndroidStatusNotificationResult> {
  try {
    return {
      ...(await action()),
      backgroundReliable: false,
    }
  } catch (error) {
    return {
      shown: false,
      reason: 'native_error',
      backgroundReliable: false,
      errorMessage: errorMessageFrom(error),
    }
  }
}

async function tryStartAndroidSettings(action: string, params?: IntentLauncher.IntentLauncherParams): Promise<unknown | null> {
  try {
    await IntentLauncher.startActivityAsync(action, params)
    return null
  } catch (error) {
    return error
  }
}

function permissionStatusFallback(
  available: boolean,
  reason: AndroidStatusNotificationPermissionStatus['reason'],
  error?: unknown,
  apiLevel = androidApiLevel()
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
