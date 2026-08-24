export type ComposerSizeMode = 'compact' | 'review' | 'large'
export type ComposerLargeOverride = 'auto' | 'hold-review' | 'force-large'
export type ComposerSizeEvent =
  | 'measure'
  | 'blur'
  | 'keyboard-hide'
  | 'manual-expand'
  | 'manual-collapse'
  | 'send-failure'
  | 'send-success'
  | 'clear'

export interface ComposerSizeState {
  mode: ComposerSizeMode
  largeOverride: ComposerLargeOverride
  lastValidContentHeight: number
  visualLineCount: number
}

export interface ResolveComposerSizeStateInput {
  content: string
  measuredContentHeight: number
  lineHeight: number
  verticalPadding: number
  state: ComposerSizeState
  event: ComposerSizeEvent
}

export function createComposerSizeState(): ComposerSizeState {
  return {
    mode: 'compact',
    largeOverride: 'auto',
    lastValidContentHeight: 0,
    visualLineCount: 1,
  }
}

function validPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function resolveVisualLines(height: number, lineHeight: number, verticalPadding: number): number {
  const safeLineHeight = validPositive(lineHeight) ? lineHeight : 1
  const normalizedHeight = Math.max(safeLineHeight, height - Math.max(0, verticalPadding))
  return Math.max(1, Math.ceil(normalizedHeight / safeLineHeight))
}

export function resolveComposerSizeState(input: ResolveComposerSizeStateInput): ComposerSizeState {
  const { content, state, event } = input
  if (event === 'send-success' || event === 'clear' || content.length === 0) {
    return createComposerSizeState()
  }

  const measuredHeight = validPositive(input.measuredContentHeight)
    ? input.measuredContentHeight
    : state.lastValidContentHeight
  const lastValidContentHeight = validPositive(measuredHeight)
    ? measuredHeight
    : Math.max(1, input.lineHeight + input.verticalPadding)
  const visualLineCount = resolveVisualLines(
    lastValidContentHeight,
    input.lineHeight,
    input.verticalPadding,
  )

  if (event === 'manual-expand') {
    return {
      mode: 'large',
      largeOverride: 'force-large',
      lastValidContentHeight,
      visualLineCount,
    }
  }

  if (event === 'manual-collapse') {
    if (visualLineCount <= 2) {
      return {
        mode: 'compact',
        largeOverride: 'auto',
        lastValidContentHeight,
        visualLineCount,
      }
    }
    return {
      mode: 'review',
      largeOverride: 'hold-review',
      lastValidContentHeight,
      visualLineCount,
    }
  }

  if (visualLineCount <= 2) {
    return {
      mode: 'compact',
      largeOverride: 'auto',
      lastValidContentHeight,
      visualLineCount,
    }
  }

  if (state.largeOverride === 'force-large') {
    return {
      mode: 'large',
      largeOverride: 'force-large',
      lastValidContentHeight,
      visualLineCount,
    }
  }

  if (state.largeOverride === 'hold-review') {
    return {
      mode: 'review',
      largeOverride: 'hold-review',
      lastValidContentHeight,
      visualLineCount,
    }
  }

  let mode: ComposerSizeMode = state.mode
  if (state.mode === 'compact') {
    mode = visualLineCount >= 8 ? 'large' : visualLineCount >= 4 ? 'review' : 'compact'
  } else if (state.mode === 'review') {
    mode = visualLineCount >= 8 ? 'large' : 'review'
  } else {
    mode = visualLineCount <= 5 ? 'review' : 'large'
  }

  return {
    mode,
    largeOverride: 'auto',
    lastValidContentHeight,
    visualLineCount,
  }
}
