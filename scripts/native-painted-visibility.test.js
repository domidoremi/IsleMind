const { PNG } = require('pngjs')
const { assertPaintedNativeNode, measurePaintedNativeNode } = require('./native-painted-visibility')

const node = { id: 'message-input', bounds: '[8,8][112,64]' }
function image(background = [25, 27, 30]) {
  const png = new PNG({ width: 120, height: 72 })
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data.set([...background, 255], offset)
  }
  return png
}
function rectangle(png, [left, top, right, bottom], rgb) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      png.data.set([...rgb, 255], (y * png.width + x) * 4)
    }
  }
}

test('rejects an accessible input whose rectangle paints only the canvas', () => {
  const png = image()
  expect(measurePaintedNativeNode(png, node).contrastPixels).toBe(0)
  expect(() => assertPaintedNativeNode(png, node)).toThrow(/node exists.*no visible paint/)
})

test('does not mistake a focus ring for visible input content', () => {
  const png = image()
  rectangle(png, [8, 8, 112, 64], [166, 200, 234])
  rectangle(png, [12, 12, 108, 60], [25, 27, 30])
  expect(() => assertPaintedNativeNode(png, node)).toThrow(/no visible paint/)
})

test.each([
  [[25, 27, 30], [226, 228, 231]],
  [[250, 250, 252], [27, 29, 32]],
])('accepts genuinely painted content against light and dark canvases', (background, foreground) => {
  const png = image(background)
  rectangle(png, [28, 25, 32, 45], foreground)
  rectangle(png, [28, 25, 46, 29], foreground)
  const result = assertPaintedNativeNode(png, node)
  expect(result.contrastPixels).toBeGreaterThan(12)
  expect(result.contrastFraction).toBeGreaterThan(0.003)
})

test('does not count small canvas noise as text or controls', () => {
  const png = image()
  rectangle(png, [20, 20, 90, 50], [25, 26, 30])
  expect(() => assertPaintedNativeNode(png, node)).toThrow(/no visible paint/)
})

test('rejects a missing, empty or offscreen native target', () => {
  const png = image()
  for (const target of [null, { ...node, bounds: '[8,8][8,64]' }, { ...node, bounds: '[-1,8][112,64]' }]) {
    expect(() => assertPaintedNativeNode(png, target)).toThrow()
  }
})
