const { concreteRoute } = require('./collect-complete-ui-web-evidence')

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
