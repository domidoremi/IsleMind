import type { ProviderConnectionReference, ProviderConnectionReferences } from '@/core'

type Translate = (key: string, options?: Record<string, unknown>) => string

export function providerConnectionReferenceDestination(reference: ProviderConnectionReference) {
  if (reference.kind === 'routing') return { pathname: '/settings/routing' as const, params: { planId: reference.id } }
  if (reference.kind === 'scene') return { pathname: '/settings/scenes' as const, params: { planId: reference.id } }
  if (reference.kind === 'conversation') return { pathname: '/chat/[id]' as const, params: { id: reference.id } }
  return undefined
}

export function providerConnectionReferenceCoverage(report: ProviderConnectionReferences, t: Translate): string[] {
  return [
    t('connectionReferences.inspected', { count: report.conversations.savedInspected, drafts: report.conversations.localDrafts }),
    ...(report.conversations.savedRemaining ? [t('connectionReferences.remaining', { count: report.conversations.savedRemaining })] : []),
    ...(report.conversations.unreadable ? [t('connectionReferences.unreadable', { count: report.conversations.unreadable })] : []),
  ]
}

export function providerConnectionDeletionImpact(report: ProviderConnectionReferences, t: Translate): string {
  const used = report.groups.filter(group => group.total)
  const unknown = report.conversations.savedRemaining + report.conversations.unreadable
  return [
    t('connectionReferences.title'),
    ...(used.length ? used.map(group => t(`connectionReferences.count.${group.kind}`, { count: group.total }))
      : [t(unknown ? 'connectionReferences.noKnownReferences' : 'connectionReferences.none')]),
    ...providerConnectionReferenceCoverage(report, t),
    t('connectionReferences.keptAfterDelete'),
    ...(used.some(group => group.kind === 'default') ? [t('connectionReferences.defaultAfterDelete')] : []),
    ...(used.some(group => group.kind === 'favorite') ? [t('connectionReferences.favoritesAfterDelete')] : []),
  ].join('\n')
}
