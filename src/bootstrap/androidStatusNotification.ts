import {
  createExpoAndroidStatusNotificationPort,
  type AndroidStatusNotificationPayload,
  type AndroidStatusNotificationPermissionRationale,
  type AndroidStatusNotificationPermissionStatus,
  type AndroidStatusNotificationResult,
  type AndroidStatusNotificationSettingsResult,
  type AndroidStatusNotificationSettingsTarget,
  type AndroidStatusNotificationUpdateOptions,
} from '@/platform/native/androidStatusNotification'

export type {
  AndroidStatusNotificationPayload,
  AndroidStatusNotificationPermissionRationale,
  AndroidStatusNotificationPermissionStatus,
  AndroidStatusNotificationResult,
  AndroidStatusNotificationSettingsResult,
  AndroidStatusNotificationSettingsTarget,
  AndroidStatusNotificationState,
  AndroidStatusNotificationUpdateOptions,
} from '@/platform/native/androidStatusNotification'

const androidStatusNotificationPort = createExpoAndroidStatusNotificationPort()

export function androidStatusNotificationsAvailable(): boolean {
  return androidStatusNotificationPort.isAvailable()
}

export function getAndroidStatusNotificationPermissionStatus(): Promise<AndroidStatusNotificationPermissionStatus> {
  return androidStatusNotificationPort.getPermissionStatus()
}

export function requestAndroidStatusNotificationPermission(
  rationale: AndroidStatusNotificationPermissionRationale,
): Promise<AndroidStatusNotificationPermissionStatus> {
  return androidStatusNotificationPort.requestPermission(rationale)
}

export function updateAndroidStatusNotification(
  payload: AndroidStatusNotificationPayload,
  options: AndroidStatusNotificationUpdateOptions = {},
): Promise<AndroidStatusNotificationResult> {
  return androidStatusNotificationPort.update(payload, options)
}

export function clearAndroidStatusNotification(): Promise<AndroidStatusNotificationResult> {
  return androidStatusNotificationPort.clear()
}

export function openAndroidStatusNotificationSettings(
  target: AndroidStatusNotificationSettingsTarget = 'notifications',
): Promise<AndroidStatusNotificationSettingsResult> {
  return androidStatusNotificationPort.openSettings(target)
}
