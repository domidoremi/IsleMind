import { getColors } from '@/theme/colors'
import { createLiquidRenderer, disposeLiquidRenderer, drawLiquidFrame, liquidRasterSize, liquidUniforms, type LiquidGL } from './liquidGlassRenderer'

function mockGL() {
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLE_STRIP: 8,
    drawingBufferWidth: 432, drawingBufferHeight: 960,
    createShader: jest.fn(() => ({})), shaderSource: jest.fn(), compileShader: jest.fn(),
    getShaderParameter: jest.fn(() => true), getShaderInfoLog: jest.fn(() => 'compile failure'),
    createProgram: jest.fn(() => ({})), createBuffer: jest.fn(() => ({})), attachShader: jest.fn(), linkProgram: jest.fn(),
    getProgramParameter: jest.fn(() => true), getProgramInfoLog: jest.fn(() => 'link failure'),
    bindBuffer: jest.fn(), bufferData: jest.fn(), getUniformLocation: jest.fn((_, name) => ({ name })),
    getAttribLocation: jest.fn(() => 0), deleteShader: jest.fn(), deleteProgram: jest.fn(), deleteBuffer: jest.fn(),
    viewport: jest.fn(), useProgram: jest.fn(), enableVertexAttribArray: jest.fn(), vertexAttribPointer: jest.fn(),
    uniform2f: jest.fn(), uniform1f: jest.fn(), uniform3f: jest.fn(), drawArrays: jest.fn(), flush: jest.fn(), endFrameEXP: jest.fn(),
  }
}

it.each(['light', 'dark'] as const)('produces finite uniforms for built-in and custom %s palettes', (mode) => {
  for (const accent of [undefined, '#000000', '#ffffff', '#e465b7', '#23A8F0']) {
    const values = liquidUniforms(getColors(mode, 'liquid-glass', null, accent), 0.42, 0.96, 119, 32000)
    for (const color of [values.canvas, values.cool, values.warm]) {
      expect(color).toHaveLength(3)
      for (const channel of color) { expect(channel).toBeGreaterThanOrEqual(0); expect(channel).toBeLessThanOrEqual(1) }
    }
    expect(values.dark).toBe(mode === 'dark' ? 1 : 0)
  }
})

it.each([[360, 800, 3], [800, 360, 3], [2048, 2732, 2], [320, 640, 1]])('caps only the decorative framebuffer (%s×%s @%s)', (width, height, density) => {
  const raster = liquidRasterSize(width, height, density)
  expect(Math.max(raster.width, raster.height) * density).toBeLessThanOrEqual(960.0001)
  expect(raster.width / raster.scale).toBeCloseTo(width)
  expect(raster.height / raster.scale).toBeCloseTo(height)
})

it('submits a single pass with current palette, phase and framebuffer dimensions', () => {
  const gl = mockGL()
  const context = gl as unknown as LiquidGL
  const renderer = createLiquidRenderer(context)
  const values = liquidUniforms(getColors('dark', 'liquid-glass'), 0.42, 1, 90, 32000)
  drawLiquidFrame(context, renderer, values, 0.25)
  expect(gl.deleteShader).toHaveBeenCalledTimes(2)
  expect(gl.viewport).toHaveBeenCalledWith(0, 0, 432, 960)
  expect(gl.uniform1f).toHaveBeenCalledWith(renderer.uniforms.phase, Math.PI)
  expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, 4)
  expect(gl.drawArrays).toHaveBeenCalledTimes(1)
  expect(gl.endFrameEXP).toHaveBeenCalledTimes(1)
  expect(gl.flush).not.toHaveBeenCalled()
  disposeLiquidRenderer(context, renderer)
  expect(gl.deleteBuffer).toHaveBeenCalledWith(renderer.buffer)
  expect(gl.deleteProgram).toHaveBeenCalledWith(renderer.program)
})

it('flushes the browser context when Expo presentation is unavailable', () => {
  const gl = mockGL()
  const context = { ...gl, endFrameEXP: undefined } as unknown as LiquidGL
  drawLiquidFrame(context, createLiquidRenderer(context), liquidUniforms(getColors('light', 'liquid-glass'), 0.42, 1, 0, 32000), 0)
  expect(gl.flush).toHaveBeenCalledTimes(1)
  expect(gl.endFrameEXP).not.toHaveBeenCalled()
})

it('cleans partially compiled shaders on failure', () => {
  const gl = mockGL()
  gl.getShaderParameter.mockReturnValueOnce(true).mockReturnValueOnce(false)
  expect(() => createLiquidRenderer(gl as unknown as LiquidGL)).toThrow('compile failure')
  expect(gl.deleteShader).toHaveBeenCalledTimes(2)
  expect(gl.createProgram).not.toHaveBeenCalled()
})

it('uses the caller-selected focus/surface canvas and clamps material strength', () => {
  const values = liquidUniforms(getColors('light', 'liquid-glass'), 3, -1, 0, 0, '#102030')
  expect(values.canvas).toEqual([16 / 255, 32 / 255, 48 / 255])
  expect(values.strength).toBe(0)
  expect(values.amplitude).toBe(1)
  expect(values.cycleMs).toBe(1000)
})

it('cleans shaders, program and buffer after link failure', () => {
  const gl = mockGL()
  gl.getProgramParameter.mockReturnValue(false)
  expect(() => createLiquidRenderer(gl as unknown as LiquidGL)).toThrow('link failure')
  expect(gl.deleteShader).toHaveBeenCalledTimes(2)
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1)
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(1)
})
