import { resolveAppFeedbackTimeout } from '@/components/ui/appFeedbackTimeout'

describe('resolveAppFeedbackTimeout', () => {
  it('falls back when the platform method is unavailable', async () => {
    await expect(resolveAppFeedbackTimeout(3200, {})).resolves.toBe(3200)
    await expect(resolveAppFeedbackTimeout(3200, null)).resolves.toBe(3200)
  })

  it('accepts a synchronous recommendation and preserves the receiver binding', async () => {
    const accessibilityInfo = {
      multiplier: 2,
      getRecommendedTimeoutMillis(this: { multiplier: number }, durationMs: number) {
        return durationMs * this.multiplier
      },
    }

    await expect(resolveAppFeedbackTimeout(1600, accessibilityInfo)).resolves.toBe(3200)
  })

  it('accepts an asynchronous recommendation', async () => {
    await expect(resolveAppFeedbackTimeout(2400, {
      getRecommendedTimeoutMillis: async (durationMs) => durationMs + 600,
    })).resolves.toBe(3000)
  })

  it('falls back when the platform method throws synchronously', async () => {
    await expect(resolveAppFeedbackTimeout(2800, {
      getRecommendedTimeoutMillis() {
        throw new Error('unsupported platform method')
      },
    })).resolves.toBe(2800)
  })

  it('falls back when the platform method rejects', async () => {
    await expect(resolveAppFeedbackTimeout(2800, {
      getRecommendedTimeoutMillis: async () => {
        throw new Error('native timeout lookup failed')
      },
    })).resolves.toBe(2800)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1])(
    'falls back for an invalid recommendation: %p',
    async (recommendedTimeout) => {
      await expect(resolveAppFeedbackTimeout(3600, {
        getRecommendedTimeoutMillis: () => recommendedTimeout,
      })).resolves.toBe(3600)
    },
  )
})
