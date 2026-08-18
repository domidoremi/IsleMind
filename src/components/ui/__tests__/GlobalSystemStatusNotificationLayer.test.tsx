import { act, render, waitFor } from '@testing-library/react-native'

import { GlobalSystemStatusNotificationLayer } from '../GlobalSystemStatusNotificationLayer'

let mockNotificationsEnabled = false
const mockClearNotification = jest.fn(async () => ({ shown: false, reason: 'cleared', backgroundReliable: false }))
const mockUpdateNotification = jest.fn(async (_payload?: unknown, _options?: unknown) => ({
  shown: true,
  reason: 'shown',
  backgroundReliable: false,
}))

jest.mock('@/bootstrap/androidStatusNotification', () => ({
  clearAndroidStatusNotification: () => mockClearNotification(),
  updateAndroidStatusNotification: (payload: unknown, options?: unknown) => mockUpdateNotification(payload, options),
}))

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({
    settings: { systemStatusNotificationsEnabled: mockNotificationsEnabled },
  }),
}))

jest.mock('@/store/chatStore', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({ conversations: [] }),
}))

jest.mock('@/store/chatStreamingStore', () => ({
  useChatStreamingStore: (selector: (state: unknown) => unknown) => selector({ activeStreams: {} }),
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('GlobalSystemStatusNotificationLayer', () => {
  beforeEach(() => {
    mockNotificationsEnabled = false
    mockClearNotification.mockClear()
    mockUpdateNotification.mockClear()
  })

  it('keeps the native bridge deferred until notifications have been enabled', async () => {
    const view = await render(<GlobalSystemStatusNotificationLayer />)

    await act(async () => Promise.resolve())
    expect(mockClearNotification).not.toHaveBeenCalled()
    expect(mockUpdateNotification).not.toHaveBeenCalled()

    mockNotificationsEnabled = true
    await view.rerender(<GlobalSystemStatusNotificationLayer />)
    mockNotificationsEnabled = false
    await view.rerender(<GlobalSystemStatusNotificationLayer />)

    await waitFor(() => expect(mockClearNotification).toHaveBeenCalledTimes(1))
  })
})
