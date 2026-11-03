import { resolveFocusedInputScroll, resolveKeyboardViewportInset } from './keyboardScrollViewport'

it('excludes only the keyboard overlap with the stable local viewport', () => {
  expect(resolveKeyboardViewportInset({ top: 110, height: 740 }, 550)).toBe(300)
  expect(resolveKeyboardViewportInset({ top: 110, height: 440 }, 550)).toBe(0)
  expect(resolveKeyboardViewportInset({ top: 110, height: 700 }, 550)).toBe(260)
  expect(resolveKeyboardViewportInset({ top: 110, height: 740 }, null)).toBe(0)
})

it('clamps a fully covered viewport and rejects invalid measurements', () => {
  expect(resolveKeyboardViewportInset({ top: 200, height: 100 }, 150)).toBe(100)
  expect(resolveKeyboardViewportInset({ top: 0, height: 0 }, 150)).toBe(0)
  expect(resolveKeyboardViewportInset({ top: 0, height: 700 }, NaN)).toBe(0)
})

it('scrolls a covered instruction above the keyboard with a reading gap', () => {
  expect(resolveFocusedInputScroll({
    viewport: { top: 110, height: 440 }, input: { top: 700, height: 76 }, offset: 120,
  })).toBe(358)
})

it('leaves an already visible field and the reading position alone', () => {
  expect(resolveFocusedInputScroll({
    viewport: { top: 110, height: 440 }, input: { top: 350, height: 120 }, offset: 120,
  })).toBe(120)
})

it('reveals the beginning, not the bottom, of an oversized multiline field', () => {
  expect(resolveFocusedInputScroll({
    viewport: { top: 110, height: 300 }, input: { top: 400, height: 600 }, offset: 120,
  })).toBe(398)
  expect(resolveFocusedInputScroll({
    viewport: { top: 110, height: 300 }, input: { top: 122, height: 600 }, offset: 398,
  })).toBe(398)
})

it('reveals a field above the viewport without producing a negative scroll offset', () => {
  expect(resolveFocusedInputScroll({
    viewport: { top: 110, height: 440 }, input: { top: 80, height: 40 }, offset: 120,
  })).toBe(78)
  expect(resolveFocusedInputScroll({
    viewport: { top: 110, height: 440 }, input: { top: 80, height: 40 }, offset: 0,
  })).toBe(0)
})
