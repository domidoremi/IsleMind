const { concreteRoute, findDefaultControls, layout } = require('./collect-complete-ui-web-evidence')

it.each([
  ['/chat/[id]', '/chat/qa-ui-missing'],
  ['/agent/run/[runId]', '/agent/run/qa-ui-missing'],
  ['/help/[slug]', '/help/chat'],
  ['/settings/knowledge/[documentId]', '/settings/knowledge/qa-ui-missing'],
])('resolves the %s route to an isolated browser fixture path', (template, expected) => {
  expect(concreteRoute(template)).toBe(expected)
})

it('fails closed when a route template needs an unconfigured parameter', () => {
  expect(() => concreteRoute('/unknown/[missing]')).toThrow('Unknown dynamic route parameter: missing')
})

it('identifies visible browser controls that still use platform appearance', () => {
  expect(findDefaultControls([
    { tag: 'BUTTON', label: 'Themed button', appearance: 'none' },
    { tag: 'INPUT', label: 'Search', appearance: 'auto' },
    { tag: 'SELECT', label: 'Choice', appearance: 'menulist' },
    { tag: 'TEXTAREA', label: 'Draft', appearance: 'none' },
    { tag: 'DIV', label: 'Custom control', appearance: 'auto' },
  ])).toEqual([
    { tag: 'INPUT', label: 'Search', appearance: 'auto' },
    { tag: 'SELECT', label: 'Choice', appearance: 'menulist' },
  ])
})

it('includes default-control findings in each route measurement', async () => {
  const page = { evaluate: async () => ({ family: 'minimal', mode: 'light', controlStyles: [
    { tag: 'BUTTON', label: 'Save', appearance: 'auto' },
  ] }) }
  await expect(layout(page)).resolves.toMatchObject({ defaultControls: [{ tag: 'BUTTON', label: 'Save', appearance: 'auto' }] })
})
