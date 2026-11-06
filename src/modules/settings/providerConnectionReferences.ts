import type { ProviderConnectionReference, ProviderConnectionReferenceTarget } from '@/core'
import type { Settings } from '@/types/settingsContracts'

export type SettingsConnectionReferencePreferences = Pick<Settings,
  'defaultProvider' | 'lastPreferredModel' | 'modelRoutingPlans' | 'scenePlans' | 'modelFavorites'>

/** Project live configuration, never last-applied provenance or historical requests. */
export function projectSettingsProviderReferences(
  settings: SettingsConnectionReferencePreferences,
  providerIds: readonly string[],
): ProviderConnectionReference[] {
  const ids = new Set(providerIds)
  const result: ProviderConnectionReference[] = []
  const add = (kind: ProviderConnectionReference['kind'], id: string, label: string, targets: ProviderConnectionReferenceTarget[]) => {
    const matching = targets.filter(target => ids.has(target.providerId))
      .map(target => ({ providerId: target.providerId, ...(target.model === undefined ? {} : { model: target.model }), role: target.role }))
    if (matching.length) result.push({ kind, id, label, targets: matching })
  }
  for (const plan of settings.modelRoutingPlans ?? []) {
    add('routing', plan.id, plan.name, [
      { ...plan.primary, role: 'primary' },
      ...(plan.mode === 'fallback' && plan.backup ? [{ ...plan.backup, role: 'backup' as const }] : []),
    ])
  }
  for (const plan of settings.scenePlans ?? []) {
    const model = plan.configuration.model
    if (!model) continue
    add('scene', plan.id, plan.name, [
      { ...model.target, role: 'model' },
      ...(model.routingPlan ? [{ ...model.routingPlan.primary, role: 'primary' as const },
        ...(model.routingPlan.mode === 'fallback' && model.routingPlan.backup
          ? [{ ...model.routingPlan.backup, role: 'backup' as const }] : [])] : []),
    ])
  }
  if (settings.defaultProvider) add('default', 'default', '', [{ providerId: settings.defaultProvider, role: 'default' }])
  if (settings.lastPreferredModel) {
    add('preferred', 'preferred', '', [{ ...settings.lastPreferredModel, role: 'model' }])
  }
  for (const favorite of settings.modelFavorites ?? []) {
    add('favorite', JSON.stringify([favorite.providerId, favorite.modelId]), favorite.modelId,
      [{ providerId: favorite.providerId, model: favorite.modelId, role: 'model' }])
  }
  return result
}
