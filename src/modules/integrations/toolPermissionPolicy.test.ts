import { decideToolPermission, resolveToolPermissionPolicyLimits } from './toolPermissionPolicy'

test.each(['read-write', 'destructive'] as const)('%s requires approval even with a visible plan and an enabled ceiling', (permission) => {
  const tool = { id: 'tool', name: 'tool', source: 'builtin', enabled: true, permission }
  const limits = resolveToolPermissionPolicyLimits({ allowReadWriteTools: true, allowDestructiveTools: true })
  const context = { intentVisible: true, evidenceSources: ['user:explicit-request'] }
  expect(decideToolPermission(tool, context, limits).decision).toBe('confirm')
  expect(decideToolPermission(tool, { ...context, userConfirmed: true }, limits).decision).toBe('allow')
  const disabled = resolveToolPermissionPolicyLimits({ allowReadWriteTools: false, allowDestructiveTools: false })
  expect(decideToolPermission(tool, { userConfirmed: true }, disabled).decision).toBe('deny')
})
