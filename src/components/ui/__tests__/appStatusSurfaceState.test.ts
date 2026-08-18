import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  resolveAppStatusIcon,
  resolveAppStatusMotion,
  resolveAppStatusSafeAreaPadding,
} from '../appStatusSurfaceState'

describe('app status surface state', () => {
  it('maps each tone to a stable semantic icon', () => {
    expect(resolveAppStatusIcon('info')).toBe('info')
    expect(resolveAppStatusIcon('success')).toBe('check')
    expect(resolveAppStatusIcon('warning')).toBe('zap')
    expect(resolveAppStatusIcon('danger')).toBe('warning')
  })

  it('keeps reduced and disabled motion opacity-only', () => {
    const reduced = resolveAppStatusMotion('reduced', true)
    const disabled = resolveAppStatusMotion('full', false)

    expect(reduced.from).toEqual({ opacity: 0 })
    expect(reduced.animate).toEqual({ opacity: 1 })
    expect(reduced.exit).toEqual({ opacity: 0 })
    expect(disabled.from).toEqual({ opacity: 1 })
    expect(disabled.animate).toEqual({ opacity: 1 })
    expect(Object.keys(reduced.animate)).not.toContain('translateY')
  })

  it('keeps full motion bounded and safe-area padding explicit', () => {
    expect(resolveAppStatusMotion('full', true)).toMatchObject({
      from: { opacity: 0, translateY: 8 },
      animate: { opacity: 1, translateY: 0 },
      duration: 160,
    })
    expect(resolveAppStatusSafeAreaPadding('top', { top: 24, bottom: 10 })).toEqual({ paddingTop: 24 })
    expect(resolveAppStatusSafeAreaPadding('bottom', { top: 24, bottom: 10 })).toEqual({ paddingBottom: 10 })
    expect(resolveAppStatusSafeAreaPadding('bottom', { top: 24, bottom: 0 })).toEqual({ paddingBottom: 10 })
    expect(resolveAppStatusSafeAreaPadding('none', { top: 24, bottom: 10 })).toEqual({})
  })

  it('keeps actions, dismissal, and long copy mobile-accessible', () => {
    const source = readFileSync(join(__dirname, '..', 'AppStatusSurface.tsx'), 'utf8')

    expect(source).toContain('accessibilityLabel={actionLabel}')
    expect(source).toContain("accessibilityLabel={dismissLabel ?? t('common.close')}")
    expect(source).toMatch(/action: \{[\s\S]*minHeight: 44/)
    expect(source).toMatch(/dismiss: \{[\s\S]*width: 44,[\s\S]*height: 44/)
    expect(source).toContain('numberOfLines={2}')
    expect(source).toContain('numberOfLines={compact ? 3 : 8}')
  })
})
