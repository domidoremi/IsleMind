export interface ProviderToolLimits {
  maxToolCallsPerStep: number
  outputCharLimit?: number
  allowReadOnlyTools?: boolean
  allowReadWriteTools?: boolean | 'visible'
  allowDestructiveTools?: boolean | 'confirm'
}

export interface ProviderToolDeclarationAdapter<TTool = unknown> {
  toolNameMap: readonly TTool[]
  target?: string
  tools: readonly unknown[]
}

export interface ProviderToolRuntimeContext<
  TManifest = unknown,
  TTool = unknown,
  TAdapter extends ProviderToolDeclarationAdapter<TTool> = ProviderToolDeclarationAdapter<TTool>,
> {
  adapter: TAdapter
  manifests: readonly TManifest[]
  catalogRevision: string
  limits: ProviderToolLimits
}

export interface ProviderToolTurnRuntimeDependencies<
  TProvider = unknown,
  TManifest = unknown,
  TTool = unknown,
  TAdapter extends ProviderToolDeclarationAdapter<TTool> = ProviderToolDeclarationAdapter<TTool>,
> {
  resolveDeclarationTarget(provider: TProvider, input: { preferredEndpoint?: string; assumeOpenAICompatibleTools: boolean; wireProtocol?: string }): string | undefined
  resolveLimits(settings: unknown): ProviderToolLimits
  listManifests(): Promise<readonly TManifest[]>
  filterManifests(manifests: readonly TManifest[], settings: unknown): readonly TManifest[]
  resolveCatalogRevision(manifests: readonly TManifest[]): string
  buildDeclarations(input: { manifests: readonly TManifest[]; target: string; permissionCeiling: 'read-only' | 'read-write' | 'destructive'; maxTools: number }): TAdapter
}

export interface ProviderToolAdmissionInput<TProvider> {
  provider: TProvider
  modelPreferredEndpoint?: string
  settings: unknown
  nativeToolSupported: boolean
  wireProtocol?: string
}

export function createAssistantProviderToolTurnRuntime<
  TProvider = unknown,
  TManifest = unknown,
  TTool = unknown,
  TAdapter extends ProviderToolDeclarationAdapter<TTool> = ProviderToolDeclarationAdapter<TTool>,
>(
  dependencies: ProviderToolTurnRuntimeDependencies<TProvider, TManifest, TTool, TAdapter>,
) {
  async function admit(input: ProviderToolAdmissionInput<TProvider>): Promise<ProviderToolRuntimeContext<TManifest, TTool, TAdapter> | undefined> {
    if (!input.nativeToolSupported) return undefined
    const target = dependencies.resolveDeclarationTarget(input.provider, {
      preferredEndpoint: input.modelPreferredEndpoint,
      assumeOpenAICompatibleTools: true,
      wireProtocol: input.wireProtocol,
    })
    if (!target) return undefined
    const limits = dependencies.resolveLimits(input.settings)
    if (limits.allowReadOnlyTools === false) return undefined
    const manifests = Object.freeze([
      ...dependencies.filterManifests(await dependencies.listManifests(), input.settings),
    ])
    if (manifests.length > 64) {
      throw new Error(`Model operation catalog contains ${manifests.length} operations; the limit is 64.`)
    }
    const permissionCeiling = resolvePermissionCeiling(limits)
    if (!permissionCeiling) return undefined
    const adapter = dependencies.buildDeclarations({ manifests, target, permissionCeiling, maxTools: 64 })
    if (!adapter.tools.length) return undefined
    return {
      adapter: { ...adapter, toolNameMap: adapter.toolNameMap },
      manifests,
      catalogRevision: dependencies.resolveCatalogRevision(manifests),
      limits: { ...limits, maxToolCallsPerStep: 1 },
    }
  }

  return { admit }
}

function resolvePermissionCeiling(
  limits: ProviderToolLimits,
): 'read-only' | 'read-write' | 'destructive' | undefined {
  if (limits.allowDestructiveTools === true || limits.allowDestructiveTools === 'confirm') return 'destructive'
  if (limits.allowReadWriteTools === true || limits.allowReadWriteTools === 'visible') return 'read-write'
  return limits.allowReadOnlyTools === false ? undefined : 'read-only'
}
