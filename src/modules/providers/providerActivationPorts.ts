import type { AIProvider } from '@/types/providerContracts'

export interface ProviderActivationStageEvent {
  providerId: string
  providerName: string
  stage: 'enabled' | 'syncing' | 'testing' | 'done' | 'failed'
  message: string
  tone: 'mint' | 'amber' | 'danger'
}

export interface ProviderActivationOperationOptions {
  signal?: AbortSignal
  expectedProvider?: Readonly<AIProvider> | null
}

export interface ProviderActivationPorts {
  readProviderConfiguration?(id: string): AIProvider | undefined
  updateProvider(
    id: string,
    updates: Partial<AIProvider>,
    options?: ProviderActivationOperationOptions,
  ): Promise<void>
  hydrateProviderKey(
    id: string,
    options?: ProviderActivationOperationOptions,
  ): Promise<AIProvider | null>
  updateProviderCredentialGroupHealth(
    providerId: string,
    groupId: string | undefined,
    ok: boolean,
    options?: ProviderActivationOperationOptions,
  ): Promise<void>
  delay?(ms: number, options?: ProviderActivationOperationOptions): Promise<void> | void
  onStage?(event: ProviderActivationStageEvent): void
}
