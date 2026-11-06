import { resolveToolReference } from './toolIdentity'
import { selectEnabledMcpConversationTools } from './mcpConversationContextPolicy'

const manifests = ['a', 'b'].map(serverId => ({ id: `mcp:${serverId}:read`, source: 'mcp', serverId, name: 'read' }))

test('qualified and canonical references select the exact tool; duplicate bare names are refused', () => {
  expect(resolveToolReference('a/read', manifests)).toBe(manifests[0])
  expect(resolveToolReference('a:read', manifests)).toBe(manifests[0])
  expect(resolveToolReference('mcp:a:read', manifests)).toBe(manifests[0])
  expect(resolveToolReference('read', manifests)).toBeNull()
  expect(resolveToolReference('read', [manifests[0]])).toBe(manifests[0])
  expect(resolveToolReference('mcp:a:read', [manifests[0], { ...manifests[0] }])).toBeNull()
})

test('the existing MCP context selector accepts a canonical scene ID without changing legacy empty semantics', () => {
  const tools = manifests.map(manifest => ({ server: { id: manifest.serverId, name: manifest.serverId }, tool: { name: manifest.name } }))
  expect(selectEnabledMcpConversationTools(tools, ['mcp:a:read'])).toEqual([tools[0]])
  expect(selectEnabledMcpConversationTools(tools, [])).toEqual(tools)
})
