import { useEffect, useMemo } from 'react'
import {
  getConversationReasoningEffortOptions,
  resolveConversationReasoningEffort,
} from '@/bootstrap/providerConversationGeneration'
import type { ReasoningEffort } from '@/core'
import type { AIProvider } from '@/types/providerContracts'

export function useComposerReasoningControl({ provider, model, value, disabled, onChange }: {
  provider: AIProvider | null | undefined
  model: string
  value: ReasoningEffort | undefined
  disabled: boolean
  onChange: (value: ReasoningEffort | undefined) => void
}) {
  const options = useMemo(() => getConversationReasoningEffortOptions(provider, model), [provider, model])
  const selected = value && !options.includes(value)
    ? resolveConversationReasoningEffort(provider, model, value)
    : value

  useEffect(() => {
    // A catalog refresh can invalidate a saved effort without changing model ID.
    // Wait for an active send to finish before updating its conversation settings.
    if (!provider || !model || disabled || selected === value) return
    onChange(selected)
  }, [provider, model, disabled, selected, value, onChange])

  return { options, value: selected }
}
