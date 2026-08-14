export interface WorkflowSearchToolSettings {
  webSearchEnabled?: boolean
  mcpEnabled?: boolean
  agentWorkflowAllowReadOnlyTools?: boolean
  agentWorkflowAllowReadWriteTools?: boolean | 'visible'
  agentWorkflowAllowDestructiveTools?: boolean | 'confirm'
}

export interface WorkflowSearchToolManifestIdentity {
  source: string
  name: string
}

export type ModelOperationPermission = 'read-only' | 'read-write' | 'destructive'

export interface ModelOperationManifestIdentity extends WorkflowSearchToolManifestIdentity {
  id: string
  enabled: boolean
  permission: ModelOperationPermission
  serverId?: string
}

export interface WorkflowSearchToolRequestIdentity {
  toolId?: string
  source?: string
  serverId?: string
  name?: string
}

export interface WorkflowSearchToolIdentity {
  toolId: string
  source: string
  serverId: string
  name: string
}

export interface WorkflowSearchToolAdmissionPolicyDependencies<
  TSettings extends WorkflowSearchToolSettings,
> {
  resolveSearchProvider: (settings: TSettings) => string
  builtinSearchTool: Readonly<WorkflowSearchToolIdentity>
}

export interface WorkflowSearchToolAdmissionPolicy<
  TSettings extends WorkflowSearchToolSettings,
> {
  shouldExposeLocalSearchTool: (settings: TSettings) => boolean
  resolveModelOperationPermissionCeiling: (settings: TSettings) => ModelOperationPermission | undefined
  filterLocalSearchToolManifests: <TManifest extends WorkflowSearchToolManifestIdentity>(
    manifests: TManifest[],
    settings: TSettings,
  ) => TManifest[]
  filterProviderNativeChatToolManifests: <TManifest extends WorkflowSearchToolManifestIdentity>(
    manifests: TManifest[],
    settings: TSettings,
  ) => TManifest[]
  isBuiltinSearchToolRequest: (
    request: WorkflowSearchToolRequestIdentity | undefined,
  ) => boolean
}

export function createWorkflowSearchToolAdmissionPolicy<
  TSettings extends WorkflowSearchToolSettings,
>(
  dependencies: WorkflowSearchToolAdmissionPolicyDependencies<TSettings>,
): WorkflowSearchToolAdmissionPolicy<TSettings> {
  const isBuiltinSearchToolManifest = (
    manifest: WorkflowSearchToolManifestIdentity,
  ): boolean => manifest.source === dependencies.builtinSearchTool.source
    && manifest.name === dependencies.builtinSearchTool.name

  const shouldExposeLocalSearchTool = (settings: TSettings): boolean => {
    const searchProvider = dependencies.resolveSearchProvider(settings)
    return Boolean(settings.webSearchEnabled)
      && searchProvider !== 'off'
      && searchProvider !== 'native'
  }

  const resolveModelOperationPermissionCeiling = (
    settings: TSettings,
  ): ModelOperationPermission | undefined => {
    if (settings.agentWorkflowAllowDestructiveTools === true ||
      settings.agentWorkflowAllowDestructiveTools === 'confirm') {
      return 'destructive'
    }
    if (settings.agentWorkflowAllowReadWriteTools === true ||
      settings.agentWorkflowAllowReadWriteTools === 'visible') {
      return 'read-write'
    }
    if (settings.agentWorkflowAllowReadOnlyTools === true) return 'read-only'
    return 'read-only'
  }

  const filterLocalSearchToolManifests = <
    TManifest extends WorkflowSearchToolManifestIdentity,
  >(
    manifests: TManifest[],
    settings: TSettings,
  ): TManifest[] => {
    if (shouldExposeLocalSearchTool(settings)) return manifests
    return manifests.filter((manifest) => !isBuiltinSearchToolManifest(manifest))
  }

  return {
    shouldExposeLocalSearchTool,
    resolveModelOperationPermissionCeiling,
    filterLocalSearchToolManifests,
    filterProviderNativeChatToolManifests<
      TManifest extends WorkflowSearchToolManifestIdentity,
    >(
      manifests: TManifest[],
      settings: TSettings,
    ): TManifest[] {
      const permissionCeiling = resolveModelOperationPermissionCeiling(settings)
      if (!permissionCeiling) return []

      const admitted = filterLocalSearchToolManifests(manifests, settings)
        .filter((manifest) => isRunnableModelOperation(manifest, permissionCeiling))
      return admitted.length > MAX_PROVIDER_MODEL_OPERATION_DECLARATIONS ? [] : admitted
    },
    isBuiltinSearchToolRequest(request): boolean {
      if (!request) return false
      if (request.toolId) {
        return request.toolId === dependencies.builtinSearchTool.toolId
      }
      if (request.name !== dependencies.builtinSearchTool.name) return false
      if (request.source && request.source !== dependencies.builtinSearchTool.source) {
        return false
      }
      if (request.serverId && request.serverId !== dependencies.builtinSearchTool.serverId) {
        return false
      }
      return true
    },
  }
}

export const MAX_PROVIDER_MODEL_OPERATION_DECLARATIONS = 64

function isRunnableModelOperation(
  manifest: WorkflowSearchToolManifestIdentity,
  permissionCeiling: ModelOperationPermission,
): boolean {
  if (!isModelOperationManifestIdentity(manifest) ||
    !permissionWithinCeiling(manifest.permission, permissionCeiling)) {
    return false
  }

  switch (manifest.source) {
    case 'builtin':
    case 'mcp':
      return isCanonicalIdentifier(manifest.serverId) &&
        manifest.id === `${manifest.source}:${manifest.serverId}:${manifest.name}`
    case 'app-action':
      return manifest.id === `${manifest.source}:${manifest.name}`
    case 'android':
      return manifest.name.startsWith('android.') &&
        manifest.id === `android:${manifest.name.slice('android.'.length)}`
    case 'rag':
      return manifest.id === 'rag:context_pack'
    case 'work-artifact':
      return manifest.id === 'work-artifact:summarize'
    default:
      return false
  }
}

function isModelOperationManifestIdentity(
  manifest: WorkflowSearchToolManifestIdentity,
): manifest is ModelOperationManifestIdentity {
  const candidate = manifest as Partial<ModelOperationManifestIdentity>
  return isCanonicalIdentifier(candidate.id) && isCanonicalIdentifier(candidate.name) &&
    candidate.enabled === true && isModelOperationPermission(candidate.permission)
}

function isCanonicalIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function isModelOperationPermission(value: unknown): value is ModelOperationPermission {
  return value === 'read-only' || value === 'read-write' || value === 'destructive'
}

function permissionWithinCeiling(
  permission: ModelOperationPermission,
  ceiling: ModelOperationPermission,
): boolean {
  return permissionRank(permission) <= permissionRank(ceiling)
}

function permissionRank(permission: ModelOperationPermission): number {
  switch (permission) {
    case 'read-only': return 0
    case 'read-write': return 1
    case 'destructive': return 2
  }
}
