import { listConversationToolManifests } from './conversationToolCatalog'
import { knowledgeRepository } from './knowledgeRepository'
import { listSkills } from './conversationSkills'
import { agentDefinitionRepository } from './agentDefinitionRepository'

/** Local catalog reads only, including cached MCP declarations; no connection or permission request. */
export async function loadCapabilityReferenceCatalog() {
  const [tools, knowledge] = await Promise.all([
    listConversationToolManifests(), knowledgeRepository.listDocuments(),
  ])
  return {
    tools: tools.map(tool => ({ value: tool.id, label: `${tool.serverName ? `${tool.serverName} / ` : ''}${tool.name}` })),
    knowledge: knowledge.map(document => ({ value: document.id, label: document.title })),
  }
}

export async function loadSettingsReferenceCatalog() {
  const [capabilities, skills] = await Promise.all([loadCapabilityReferenceCatalog(), listSkills()])
  const agents: { value: string; label: string }[] = []
  let afterId = ''
  for (;;) {
    const page = await agentDefinitionRepository.list({ afterId, limit: 50 })
    agents.push(...page.map(agent => ({ value: agent.id, label: agent.name })))
    if (page.length < 50) break
    afterId = page[page.length - 1].id
  }
  return {
    ...capabilities,
    skills: skills.map(skill => ({ value: skill.id, label: skill.name })),
    agents,
  }
}
