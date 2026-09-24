import { act, render } from '@testing-library/react-native'
import { getColors } from '@/theme/colors'
import { createLiquidRenderer, disposeLiquidRenderer, drawLiquidFrame, liquidUniforms } from './liquidGlassRenderer'
import { LiquidGlassCanvas } from './LiquidGlassCanvas.native'

const mockContext: { isleLiquidRenderer?: object } = {}
let mockTick: (frame: { timeSincePreviousFrame: number | null }) => void
const mockClock = { setActive: jest.fn() }
jest.mock('expo', () => ({ requireOptionalNativeModule: () => ({}) }))
jest.mock('expo-gl', () => ({
  GLView: (props: object) => require('react').createElement(require('react-native').View, props),
  getWorkletContext: () => mockContext,
}))
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
  useFrameCallback: (callback: typeof mockTick) => { mockTick = callback; return mockClock },
  runOnUI: (callback: (...args: unknown[]) => unknown) => callback,
  runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
}))
jest.mock('./liquidGlassRenderer', () => ({
  ...jest.requireActual('./liquidGlassRenderer'),
  createLiquidRenderer: jest.fn(() => ({ program: {}, buffer: {} })),
  drawLiquidFrame: jest.fn(),
  disposeLiquidRenderer: jest.fn(),
}))

const values = liquidUniforms(getColors('light', 'liquid-glass'), 0.42, 1, 10, 32000)
const props = { values, animated: true, style: { width: 320, height: 640 }, onReady: jest.fn(), onError: jest.fn() }
beforeEach(() => { jest.clearAllMocks(); delete mockContext.isleLiquidRenderer })

it('creates one renderer, follows display ticks, freezes/resumes, and cleans up on unmount', async () => {
  const screen = await render(<LiquidGlassCanvas {...props} />)
  await act(() => screen.getByTestId('liquid-glass-gpu').props.onContextCreate({ contextId: 1 }))
  expect(createLiquidRenderer).toHaveBeenCalledTimes(1)
  expect(props.onReady).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 144; i++) await act(() => mockTick({ timeSincePreviousFrame: 1000 / 144 }))
  expect(drawLiquidFrame).toHaveBeenCalledTimes(145)
  const phase = jest.mocked(drawLiquidFrame).mock.calls.at(-1)![3]
  expect(phase).toBeCloseTo(1000 / values.cycleMs)
  await screen.rerender(<LiquidGlassCanvas {...props} animated={false} />)
  expect(mockClock.setActive).toHaveBeenLastCalledWith(false)
  await screen.rerender(<LiquidGlassCanvas {...props} animated />)
  await act(() => mockTick({ timeSincePreviousFrame: null }))
  expect(jest.mocked(drawLiquidFrame).mock.calls.at(-1)![3]).toBeCloseTo(phase)
  await screen.unmount()
  expect(disposeLiquidRenderer).toHaveBeenCalledTimes(1)
  expect(mockContext.isleLiquidRenderer).toBeUndefined()
  expect(mockClock.setActive).toHaveBeenLastCalledWith(false)
})

it('draws a still surface without a loop and refreshes it after a palette change', async () => {
  const screen = await render(<LiquidGlassCanvas {...props} animated={false} />)
  await act(() => screen.getByTestId('liquid-glass-gpu').props.onContextCreate({ contextId: 1 }))
  expect(mockClock.setActive).not.toHaveBeenCalledWith(true)
  const dark = liquidUniforms(getColors('dark', 'liquid-glass'), 0.42, 1, 10, 32000)
  await screen.rerender(<LiquidGlassCanvas {...props} animated={false} values={dark} />)
  expect(drawLiquidFrame).toHaveBeenLastCalledWith(mockContext, mockContext.isleLiquidRenderer, dark, 0)
  expect(createLiquidRenderer).toHaveBeenCalledTimes(1)
})

it('releases resources and reports a failed frame instead of keeping a black canvas', async () => {
  const screen = await render(<LiquidGlassCanvas {...props} />)
  await act(() => screen.getByTestId('liquid-glass-gpu').props.onContextCreate({ contextId: 1 }))
  jest.mocked(drawLiquidFrame).mockImplementationOnce(() => { throw new Error('context lost') })
  await act(() => mockTick({ timeSincePreviousFrame: 16 }))
  expect(props.onError).toHaveBeenCalledTimes(1)
  expect(disposeLiquidRenderer).toHaveBeenCalledTimes(1)
  await act(() => mockTick({ timeSincePreviousFrame: 16 }))
  expect(props.onError).toHaveBeenCalledTimes(1)
})

it('ignores a late native context callback after the owning route unmounts', async () => {
  const screen = await render(<LiquidGlassCanvas {...props} />)
  const create = screen.getByTestId('liquid-glass-gpu').props.onContextCreate
  await screen.unmount()
  await act(() => create({ contextId: 1 }))
  expect(createLiquidRenderer).not.toHaveBeenCalled()
  expect(props.onReady).not.toHaveBeenCalled()
})

it('falls back if the native driver removes an active context', async () => {
  const screen = await render(<LiquidGlassCanvas {...props} />)
  await act(() => screen.getByTestId('liquid-glass-gpu').props.onContextCreate({ contextId: 1 }))
  delete mockContext.isleLiquidRenderer
  await act(() => mockTick({ timeSincePreviousFrame: 16 }))
  expect(props.onError).toHaveBeenCalledTimes(1)
})
