import { act, renderHook } from '@testing-library/react-native'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { useNavigationTrigger } from '../AnimatedNavigationTrigger'

jest.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: jest.fn(),
}))

jest.mock('@/components/ui/isle/Primitives', () => ({
  IsleIconButton: () => null,
  IsleListItem: () => null,
}))

jest.mock('../AnimatedNavigationIcon', () => ({
  AnimatedNavigationIcon: () => null,
}))

const mockedUseMotionPreference = jest.mocked(useMotionPreference)

describe('useNavigationTrigger', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockedUseMotionPreference.mockReturnValue('full')
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('starts navigation immediately while the full-motion feedback runs in parallel', async () => {
    const onNavigate = jest.fn()
    const { result, unmount } = await renderHook(() => useNavigationTrigger(onNavigate, { durationMs: 224 }))

    await act(async () => {
      result.current.trigger()
    })

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(result.current.running).toBe(true)
    expect(result.current.active).toBe(true)

    await act(async () => {
      result.current.trigger()
    })
    expect(onNavigate).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(223)
    })
    expect(result.current.running).toBe(true)

    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(result.current.running).toBe(false)
    expect(result.current.active).toBe(false)
    unmount()
  })

  it('releases the trigger when navigation throws synchronously', async () => {
    const onNavigate = jest.fn(() => {
      throw new Error('navigation failed')
    })
    const { result, unmount } = await renderHook(() => useNavigationTrigger(onNavigate, { durationMs: 224 }))

    await act(async () => {
      result.current.trigger()
    })

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(result.current.running).toBe(false)
    expect(result.current.active).toBe(false)
    unmount()
  })

  it('releases the trigger when a full-motion navigation rejects', async () => {
    const onNavigate = jest.fn(() => Promise.reject(new Error('navigation rejected')))
    const { result, unmount } = await renderHook(() => useNavigationTrigger(onNavigate, { durationMs: 224 }))

    await act(async () => {
      result.current.trigger()
      await Promise.resolve()
    })

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(result.current.running).toBe(false)
    expect(result.current.active).toBe(false)
    unmount()
  })

  it('does not let a stale rejection clear a later navigation run', async () => {
    let rejectFirst: ((reason?: unknown) => void) | undefined
    let resolveSecond: (() => void) | undefined
    const firstNavigation = new Promise<void>((_, reject) => {
      rejectFirst = reject
    })
    const secondNavigation = new Promise<void>((resolve) => {
      resolveSecond = resolve
    })
    const onNavigate = jest.fn()
      .mockImplementationOnce(() => firstNavigation)
      .mockImplementationOnce(() => secondNavigation)
    const { result, unmount } = await renderHook(() => useNavigationTrigger(onNavigate, { durationMs: 20 }))

    await act(async () => {
      result.current.trigger()
      jest.advanceTimersByTime(20)
    })
    expect(result.current.running).toBe(false)

    await act(async () => {
      result.current.trigger()
    })
    expect(result.current.running).toBe(true)

    await act(async () => {
      rejectFirst?.(new Error('stale rejection'))
      await Promise.resolve()
    })
    expect(result.current.running).toBe(true)

    await act(async () => {
      resolveSecond?.()
    })
    unmount()
  })

  it('keeps reduced motion immediate and timer-free while fencing async duplicates', async () => {
    mockedUseMotionPreference.mockReturnValue('reduced')
    let resolveNavigation: (() => void) | undefined
    const onNavigate = jest.fn(() => new Promise<void>((resolve) => {
      resolveNavigation = resolve
    }))
    const { result, unmount } = await renderHook(() => useNavigationTrigger(onNavigate))

    await act(async () => {
      result.current.trigger()
    })

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(result.current.active).toBe(false)
    expect(result.current.running).toBe(true)

    await act(async () => {
      jest.advanceTimersByTime(1000)
    })
    expect(result.current.running).toBe(true)

    await act(async () => {
      result.current.trigger()
    })
    expect(onNavigate).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveNavigation?.()
      await Promise.resolve()
    })
    expect(result.current.running).toBe(false)
    unmount()
  })
})
