import {
  createComposerSizeState,
  resolveComposerSizeState,
} from './composerLongDraftState'

const lineHeight = 22
const verticalPadding = 16
const heightForLines = (lines: number) => lines * lineHeight + verticalPadding

function measure(
  lines: number,
  state = createComposerSizeState(),
  event: Parameters<typeof resolveComposerSizeState>[0]['event'] = 'measure',
) {
  return resolveComposerSizeState({
    content: 'draft',
    measuredContentHeight: heightForLines(lines),
    lineHeight,
    verticalPadding,
    state,
    event,
  })
}

describe('resolveComposerSizeState', () => {
  it('uses 4/2 line hysteresis for Compact and Review', () => {
    const review = measure(4)
    expect(review.mode).toBe('review')
    expect(measure(3, review).mode).toBe('review')
    expect(measure(2, review).mode).toBe('compact')

    const compactAtThree = measure(3)
    expect(compactAtThree.mode).toBe('compact')
  })

  it('uses 8/5 line hysteresis for Review and Large', () => {
    const review = measure(4)
    const large = measure(8, review)
    expect(large.mode).toBe('large')
    expect(measure(6, large).mode).toBe('large')
    expect(measure(5, large).mode).toBe('review')
  })

  it('keeps Review and Large through blur and keyboard hide', () => {
    const review = measure(4)
    expect(measure(4, review, 'blur').mode).toBe('review')
    const large = measure(8, review)
    expect(measure(8, large, 'keyboard-hide').mode).toBe('large')
  })

  it('honors manual expand and hold-review collapse', () => {
    const review = measure(4)
    const forcedLarge = measure(4, review, 'manual-expand')
    expect(forcedLarge).toMatchObject({ mode: 'large', largeOverride: 'force-large' })

    const heldReview = measure(9, forcedLarge, 'manual-collapse')
    expect(heldReview).toMatchObject({ mode: 'review', largeOverride: 'hold-review' })
    expect(measure(12, heldReview).mode).toBe('review')
    expect(measure(2, heldReview)).toMatchObject({ mode: 'compact', largeOverride: 'auto' })
  })

  it('ignores invalid transient measurements for non-empty text', () => {
    const review = measure(4)
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const next = resolveComposerSizeState({
        content: 'still present',
        measuredContentHeight: invalid,
        lineHeight,
        verticalPadding,
        state: review,
        event: 'measure',
      })
      expect(next.mode).toBe('review')
      expect(next.lastValidContentHeight).toBe(heightForLines(4))
    }
  })

  it('uses the measured font-scale line height instead of character count', () => {
    const scaledLineHeight = 33
    const result = resolveComposerSizeState({
      content: '四行内容不依赖字符宽度',
      measuredContentHeight: scaledLineHeight * 4 + verticalPadding,
      lineHeight: scaledLineHeight,
      verticalPadding,
      state: createComposerSizeState(),
      event: 'measure',
    })
    expect(result).toMatchObject({ mode: 'review', visualLineCount: 4 })
  })

  it('resets only on empty content, clear, or successful send', () => {
    const large = measure(8, measure(4))
    expect(resolveComposerSizeState({
      content: 'restored text',
      measuredContentHeight: heightForLines(8),
      lineHeight,
      verticalPadding,
      state: large,
      event: 'send-failure',
    }).mode).toBe('large')
    expect(resolveComposerSizeState({
      content: '',
      measuredContentHeight: 0,
      lineHeight,
      verticalPadding,
      state: large,
      event: 'clear',
    })).toEqual(createComposerSizeState())
    expect(resolveComposerSizeState({
      content: '',
      measuredContentHeight: 0,
      lineHeight,
      verticalPadding,
      state: large,
      event: 'send-success',
    })).toEqual(createComposerSizeState())
  })
})
