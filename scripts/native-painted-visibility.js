const assert = require('node:assert/strict')

function nativeBounds(node) {
  assert.ok(node, 'A native node is required before checking its paint')
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(node.bounds ?? '')
  assert.ok(match, 'Invalid native bounds for ' + node.id)
  return match.slice(1).map(Number)
}

function measurePaintedNativeNode(png, node, { insetFraction = 0.12, channelDelta = 36 } = {}) {
  const [left, top, right, bottom] = nativeBounds(node)
  assert.ok(left >= 0 && top >= 0 && right <= png.width && bottom <= png.height,
    'Native node is outside the screenshot: ' + node.id)
  const inset = Math.ceil(Math.min(right - left, bottom - top) * insetFraction)
  const region = [left + inset, top + inset, right - inset, bottom - inset]
  assert.ok(region[2] > region[0] && region[3] > region[1], 'Native node has no painted interior: ' + node.id)
  const colors = new Map()
  let pixels = 0
  for (let y = region[1]; y < region[3]; y += 1) {
    for (let x = region[0]; x < region[2]; x += 1) {
      const offset = (y * png.width + x) * 4
      const color = [...png.data.subarray(offset, offset + 3)].join(',')
      colors.set(color, (colors.get(color) ?? 0) + 1)
      pixels += 1
    }
  }
  const dominant = [...colors.entries()].reduce((best, entry) => entry[1] > best[1] ? entry : best)
  const background = dominant[0].split(',').map(Number)
  let contrastPixels = 0
  for (const [color, count] of colors) {
    const channels = color.split(',').map(Number)
    if (channels.some((channel, index) => Math.abs(channel - background[index]) >= channelDelta)) {
      contrastPixels += count
    }
  }
  return {
    id: node.id, bounds: [left, top, right, bottom], region, pixels,
    dominantColor: background, distinctColors: colors.size, contrastPixels,
    contrastFraction: contrastPixels / pixels,
  }
}

function assertPaintedNativeNode(png, node, options = {}) {
  const { minimumContrastPixels = 12, minimumContrastFraction = 0.003, ...measurement } = options
  const result = measurePaintedNativeNode(png, node, measurement)
  // Test the content interior, not the border/focus ring or accessibility tree.
  assert.ok(result.contrastPixels >= minimumContrastPixels && result.contrastFraction >= minimumContrastFraction,
    `${node.id}: native node exists but its content has no visible paint (${result.contrastPixels}/${result.pixels} contrasting pixels)`)
  return result
}

module.exports = { assertPaintedNativeNode, measurePaintedNativeNode, nativeBounds }
