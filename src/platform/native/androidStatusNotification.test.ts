import {
  createExpoAndroidStatusNotificationPort,
  type AndroidStatusNotificationAdapterDependencies,
  type AndroidStatusNotificationNativeModule,
} from './androidStatusNotification'

function createDependencies(overrides: Partial<AndroidStatusNotificationAdapterDependencies> = {}) {
  const nativeCalls: string[] = []
  const nativeModule: AndroidStatusNotificationNativeModule = {
    async getPermissionStatus() {
      nativeCalls.push('permission')
      return { available: true, granted: true, backgroundReliable: false, androidApiLevel: 36 }
    },
    async updateStatus() {
      nativeCalls.push('update')
      return { shown: true, reason: 'shown', backgroundReliable: false }
    },
    async clearStatus() {
      nativeCalls.push('clear')
      return { shown: false, reason: 'cleared', backgroundReliable: false }
    },
  }
  const dependencies: AndroidStatusNotificationAdapterDependencies = {
    platform: { os: 'android', version: 36 },
    nativeModule,
    postNotificationsPermission: 'android.permission.POST_NOTIFICATIONS',
    grantedPermissionResult: 'granted',
    requestPermission: async () => 'granted',
    applicationId: 'com.islemind.app',
    startActivity: async () => undefined,
    ...overrides,
  }
  return { dependencies, nativeCalls }
}

const payload = {
  state: 'generating' as const,
  title: 'Generating',
  message: 'Thinking',
}

describe('Expo Android status notification port', () => {
  it('fails closed when the native runtime is unavailable', async () => {
    const { dependencies } = createDependencies({
      platform: { os: 'web', version: 0 },
      nativeModule: undefined,
    })
    const port = createExpoAndroidStatusNotificationPort(dependencies)

    expect(port.isAvailable()).toBe(false)
    await expect(port.getPermissionStatus()).resolves.toMatchObject({
      available: false,
      granted: false,
      reason: 'unavailable',
    })
    await expect(port.update(payload, { enabled: true })).resolves.toEqual({
      shown: false,
      reason: 'unavailable',
      backgroundReliable: false,
    })
  })

  it('requires explicit enablement before permission or native work', async () => {
    const { dependencies, nativeCalls } = createDependencies()
    const port = createExpoAndroidStatusNotificationPort(dependencies)

    await expect(port.update(payload)).resolves.toEqual({
      shown: false,
      reason: 'disabled',
      backgroundReliable: false,
    })
    expect(nativeCalls).toEqual([])

    await expect(port.update(payload, { enabled: true })).resolves.toMatchObject({ shown: true, reason: 'shown' })
    expect(nativeCalls).toEqual(['permission', 'update'])
  })

  it('allows an admitted foreground-service notification without the preference flag', async () => {
    const { dependencies, nativeCalls } = createDependencies()
    const port = createExpoAndroidStatusNotificationPort(dependencies)

    await expect(port.update({ ...payload, foregroundService: true })).resolves.toMatchObject({ shown: true })
    expect(nativeCalls).toEqual(['permission', 'update'])
  })

  it('normalizes permission and native failures without claiming background reliability', async () => {
    const { dependencies } = createDependencies({
      requestPermission: async () => {
        throw new Error('permission bridge failed')
      },
      nativeModule: {
        async getPermissionStatus() {
          throw new Error('native permission failed')
        },
        async updateStatus() {
          throw new Error('native update failed')
        },
        async clearStatus() {
          throw new Error('native clear failed')
        },
      },
    })
    const port = createExpoAndroidStatusNotificationPort(dependencies)

    await expect(port.requestPermission({
      title: 'Permission',
      message: 'Allow notifications',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    })).resolves.toMatchObject({
      available: true,
      granted: false,
      backgroundReliable: false,
      reason: 'native_error',
      errorMessage: 'permission bridge failed',
    })
    await expect(port.update(payload, { enabled: true })).resolves.toMatchObject({
      shown: false,
      backgroundReliable: false,
      reason: 'native_error',
      errorMessage: 'native permission failed',
    })
    await expect(port.clear()).resolves.toMatchObject({
      shown: false,
      backgroundReliable: false,
      reason: 'native_error',
      errorMessage: 'native clear failed',
    })
  })

  it('rejects malformed native permission and status results', async () => {
    const { dependencies: malformedPermissionDependencies } = createDependencies({
      nativeModule: {
        async getPermissionStatus() {
          return { available: 'yes', granted: 'yes', backgroundReliable: false }
        },
        async updateStatus() {
          return { shown: 'yes', reason: 42, backgroundReliable: false }
        },
        async clearStatus() {
          return { shown: false, reason: 42, backgroundReliable: false }
        },
      },
    })
    const permissionPort = createExpoAndroidStatusNotificationPort(malformedPermissionDependencies)

    await expect(permissionPort.getPermissionStatus()).resolves.toMatchObject({
      available: true,
      granted: false,
      backgroundReliable: false,
      reason: 'native_error',
      errorMessage: 'Android status notification native permission status is invalid.',
    })

    const { dependencies: malformedStatusDependencies } = createDependencies({
      nativeModule: {
        async getPermissionStatus() {
          return { available: true, granted: true, backgroundReliable: false }
        },
        async updateStatus() {
          return { shown: 'yes', reason: 42, backgroundReliable: false }
        },
        async clearStatus() {
          return { shown: false, reason: 42, backgroundReliable: false }
        },
      },
    })
    const statusPort = createExpoAndroidStatusNotificationPort(malformedStatusDependencies)
    await expect(statusPort.update(payload, { enabled: true })).resolves.toMatchObject({
      shown: false,
      backgroundReliable: false,
      reason: 'native_error',
      errorMessage: 'Android status notification native status result is invalid.',
    })
    await expect(statusPort.clear()).resolves.toMatchObject({
      shown: false,
      backgroundReliable: false,
      reason: 'native_error',
      errorMessage: 'Android status notification native status result is invalid.',
    })
  })

  it('preserves API gating and the settings fallback order', async () => {
    const attempts: string[] = []
    const { dependencies } = createDependencies({
      platform: { os: 'android', version: 35 },
      startActivity: async (action) => {
        attempts.push(action)
        if (action === 'android.settings.APP_NOTIFICATION_SETTINGS') throw new Error('primary unavailable')
      },
    })
    const port = createExpoAndroidStatusNotificationPort(dependencies)

    await expect(port.openSettings('promoted')).resolves.toEqual({
      opened: false,
      target: 'promoted',
      reason: 'unsupported_api',
    })
    await expect(port.openSettings('notifications')).resolves.toEqual({
      opened: true,
      target: 'notifications',
      reason: 'opened',
    })
    expect(attempts).toEqual([
      'android.settings.APP_NOTIFICATION_SETTINGS',
      'android.settings.APPLICATION_DETAILS_SETTINGS',
    ])
  })

  it('keeps notification actions fail-closed when the settings bridge is unavailable', async () => {
    const nativeCalls: string[] = []
    jest.doMock('react-native', () => ({
      NativeModules: {
        AndroidStatusNotification: {
          async getPermissionStatus() {
            nativeCalls.push('permission')
            return { available: true, granted: true, backgroundReliable: false, androidApiLevel: 36 }
          },
          async updateStatus() {
            nativeCalls.push('update')
            return { shown: true, reason: 'shown', backgroundReliable: false }
          },
          async clearStatus() {
            nativeCalls.push('clear')
            return { shown: false, reason: 'cleared', backgroundReliable: false }
          },
        },
      },
      Platform: { OS: 'android', Version: 36 },
      PermissionsAndroid: {
        PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
        RESULTS: { GRANTED: 'granted' },
      },
    }))
    jest.doMock('expo-application', () => ({ applicationId: 'com.islemind.app' }))
    jest.doMock('expo-intent-launcher', () => {
      throw new Error('settings bridge missing')
    })

    const port = createExpoAndroidStatusNotificationPort()

    expect(port.isAvailable()).toBe(true)
    await expect(port.update(payload, { enabled: true })).resolves.toMatchObject({ shown: true, reason: 'shown' })
    await expect(port.clear()).resolves.toMatchObject({ shown: false, reason: 'cleared' })
    await expect(port.openSettings()).resolves.toEqual({
      opened: false,
      target: 'notifications',
      reason: 'failed',
      errorMessage: 'Android notification settings launcher is unavailable.',
    })
    expect(nativeCalls).toEqual(['permission', 'update', 'clear'])

    jest.dontMock('react-native')
    jest.dontMock('expo-application')
    jest.dontMock('expo-intent-launcher')
  })
})
