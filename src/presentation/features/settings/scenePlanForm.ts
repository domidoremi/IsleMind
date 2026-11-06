import { snapshotPlainData, type ScenePlan } from '@/core'
import { normalizeScenePlan } from '@/modules/settings'
import type { ScenePlanCatalog } from './scenePlanWorkspacePort'

export interface ScenePlanForm {
  plan: ScenePlan
  thresholdText: string
  variableDrafts: Record<string, string>
  modelMode: 'keep' | 'single' | 'routing'
  resourceModes: Record<'skillIds' | 'enabledTools' | 'knowledgeSources', 'keep' | 'selected' | 'none'>
}

export function scenePlanToForm(plan: ScenePlan, globalThreshold: number): ScenePlanForm {
  plan = snapshotPlainData(plan)
  return {
    plan: { ...plan, configuration: { ...plan.configuration } },
    thresholdText: String((plan.configuration.contextPolicy?.remoteCompactThreshold ?? globalThreshold) * 100),
    variableDrafts: Object.fromEntries(Object.entries(plan.configuration.skillVariables ?? {}).map(([name, value]) => [name, String(value)])),
    modelMode: !plan.configuration.model ? 'keep' : plan.configuration.model.routingPlan ? 'routing' : 'single',
    resourceModes: Object.fromEntries((['skillIds', 'enabledTools', 'knowledgeSources'] as const).map(field => [
      field, plan.configuration[field] === undefined ? 'keep' : plan.configuration[field]!.length ? 'selected' : 'none',
    ])) as ScenePlanForm['resourceModes'],
  }
}

export function scenePlanFromForm(form: ScenePlanForm, catalog: ScenePlanCatalog | undefined): ScenePlan | undefined {
  const configuration = { ...form.plan.configuration }
  if (form.modelMode === 'keep') delete configuration.model
  else if (!configuration.model || form.modelMode === 'routing' && !configuration.model.routingPlan) return undefined
  else if (form.modelMode === 'single') configuration.model = { target: configuration.model.target }
  for (const field of ['skillIds', 'enabledTools', 'knowledgeSources'] as const) {
    if (form.resourceModes[field] === 'keep') delete configuration[field]
    else if (form.resourceModes[field] === 'none') configuration[field] = []
    else if (!configuration[field]?.length) return undefined
  }
  if (configuration.contextPolicy) {
    const text = form.thresholdText.trim()
    if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return undefined
    const remoteCompactThreshold = Number(text) / 100
    configuration.contextPolicy = { schema: 'islemind.conversation-context-policy.v1', remoteCompactThreshold }
  }
  if (configuration.skillIds?.length) {
    const definitions = new Map(configuration.skillIds.flatMap(id => catalog?.skillVariables[id] ?? []).map(variable => [variable.name, variable]))
    const variables: Record<string, string | number | boolean> = {}
    for (const [name, text] of Object.entries(form.variableDrafts)) {
      if (!text.trim()) continue
      const definition = definitions.get(name)
      const original = configuration.skillVariables?.[name]
      const type = definition?.type ?? (typeof original === 'number' ? 'number' : typeof original === 'boolean' ? 'boolean' : 'text')
      if (type === 'number') {
        if (!Number.isFinite(Number(text))) return undefined
        variables[name] = Number(text)
      } else if (type === 'boolean') {
        if (text !== 'true' && text !== 'false') return undefined
        variables[name] = text === 'true'
      } else variables[name] = text
    }
    if (Object.keys(variables).length) configuration.skillVariables = variables
    else delete configuration.skillVariables
  } else delete configuration.skillVariables
  return normalizeScenePlan({ ...form.plan, name: form.plan.name.trim(), description: form.plan.description?.trim(), configuration })
}
