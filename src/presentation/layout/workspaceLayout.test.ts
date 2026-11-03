import { resolveWorkspaceLayout } from './workspaceLayout'

it.each([320, 390, 900, 1079])('keeps %s-wide screens in one reading column', width => {
  expect(resolveWorkspaceLayout({ width, height: 844 }).wide).toBe(false)
})

it('uses two columns only when both width and height support reading', () => {
  expect(resolveWorkspaceLayout({ width: 1280, height: 900 }).wide).toBe(true)
  expect(resolveWorkspaceLayout({ width: 1280, height: 390 }).wide).toBe(false)
})

it('returns large text to one column and scales wide context columns with text', () => {
  expect(resolveWorkspaceLayout({ width: 1280, height: 900, fontScale: 1.6 }).wide).toBe(false)
  expect(resolveWorkspaceLayout({ width: 2400, height: 1200, fontScale: 2 }).sidebarWidth).toBe(600)
})

it.each([0, -1, NaN, Infinity])('fails safely for an invalid font scale (%s)', fontScale => {
  expect(resolveWorkspaceLayout({ width: 1280, height: 900, fontScale })).toEqual(resolveWorkspaceLayout({ width: 1280, height: 900 }))
})
