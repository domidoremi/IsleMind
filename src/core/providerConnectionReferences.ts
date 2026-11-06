/** Configuration references only; these facts grant no execution or write authority. */
export type ProviderConnectionReferenceKind = 'routing' | 'scene' | 'conversation' | 'default' | 'preferred' | 'favorite'

export interface ProviderConnectionReferenceTarget {
  providerId: string
  model?: string
  role: 'model' | 'primary' | 'backup' | 'default'
}

export interface ProviderConnectionReference {
  kind: ProviderConnectionReferenceKind
  id: string
  label: string
  targets: ProviderConnectionReferenceTarget[]
  draft?: boolean
}

export interface ProviderConnectionReferenceGroup {
  kind: ProviderConnectionReferenceKind
  total: number
  items: ProviderConnectionReference[]
  truncated: boolean
}

export interface ProviderConnectionReferences {
  providerIds: string[]
  groups: ProviderConnectionReferenceGroup[]
  conversations: {
    savedInspected: number
    savedRemaining: number
    unreadable: number
    localDrafts: number
  }
  capturedAt: number
}
