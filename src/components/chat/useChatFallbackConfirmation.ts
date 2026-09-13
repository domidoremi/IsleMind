import { useEffect, useRef } from 'react'
import type { TFunction } from 'i18next'
import { bindProviderFallbackConfirmation } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import type { useIsleDialog } from '@/components/ui/isle'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'

export function useChatFallbackConfirmation(input: {
  active: boolean; conversationId?: string; providers: readonly AIProvider[]
  dialog: ReturnType<typeof useIsleDialog>; t: TFunction
}) {
  const providers = useRef(input.providers)
  providers.current = input.providers
  const { active, conversationId, dialog, t } = input
  useEffect(() => {
    if (!active || !conversationId) return
    return bindProviderFallbackConfirmation(conversationId, (request) => {
      const label = (target: { providerId: string; model: string }) => {
        const provider = providers.current.find((item) => item.id === target.providerId)
        return `${provider ? resolveProviderDisplayName(provider, t('providerSettings.customProvider')) : target.providerId} · ${target.model}`
      }
      return dialog.confirm({
        title: t('modelAvailability.confirmFallbackTitle'), signal: request.signal, tone: 'amber',
        message: [t('modelAvailability.preferredTarget', { target: label(request.preferred) }),
          t('modelAvailability.candidateTarget', { target: label(request.candidate) }),
          request.candidate.protocolAdapterId, request.candidate.region,
          request.candidate.costTier ? t('modelAvailability.costTier', { tier: request.candidate.costTier }) : undefined,
          t('modelAvailability.confirmFallbackMessage')].filter(Boolean).join('\n'),
        confirmLabel: t('modelAvailability.allowThisRequest'), cancelLabel: t('common.cancel'),
      })
    })
  }, [active, conversationId, dialog, t])
}
