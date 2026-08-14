import type { SkillDefinition } from '@/types/skillContracts'
import { listMcpServers } from '@/bootstrap/mcpCatalog'
import { listSkills } from '@/bootstrap/conversationSkills'
import {
  readApplicationDataRecord,
  writeApplicationDataRecord,
} from '@/bootstrap/applicationDataRecords'
import { buildToolchainAndroidControlPlaneSnapshot } from '@/bootstrap/toolchainAndroidControlPlaneSnapshot'
import {
  TOOLCHAIN_ANDROID_CONTROL_PLANE_APPLICATION_POLICY,
  TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_REQUEST_POLICY,
  TOOLCHAIN_PORTABLE_SKILL_MANIFEST_ASSEMBLY,
  TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY,
  TOOLCHAIN_REGISTRY_POLICY,
} from '@/bootstrap/toolchainComposition'
import type { ToolchainInstallActionKind, ToolchainRuntimeKind } from '@/modules/integrations'
import type {
  ToolchainAndroidControlPlaneBuildInput,
  ToolchainAndroidControlPlaneSnapshot,
  ToolchainControlPlaneActionApplicationResult,
  ToolchainControlPlaneActionRequest,
  ToolchainDoctorReport,
  ToolchainInstallPlan,
  ToolchainPermissionGrant,
  ToolchainRegistrationRecord,
  ToolchainRegistryBuildInput,
  ToolchainRegistrySnapshot,
  ToolchainRuntimeSnapshot,
  ToolchainScopeRequest,
} from '@/modules/integrations'

const TOOLCHAIN_CATALOG_STORAGE_KEY = 'TOOLCHAIN_REGISTERED_CATALOG'
const { createToolchainManifestFromPortableSkill } = TOOLCHAIN_PORTABLE_SKILL_MANIFEST_ASSEMBLY
const { createActionRequest: createToolchainControlPlaneActionRequest } = TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_REQUEST_POLICY
const { applyControlPlaneAction: applyToolchainControlPlaneAction } = TOOLCHAIN_ANDROID_CONTROL_PLANE_APPLICATION_POLICY
const {
  buildDoctorReport: buildToolchainDoctorReport,
  buildInstallPlan: buildToolchainInstallPlan,
  buildRegistrySnapshot: buildToolchainRegistrySnapshot,
} = TOOLCHAIN_REGISTRY_POLICY

export interface ToolchainControlPlaneCatalogSnapshot {
  registry: ToolchainRegistrySnapshot
  installPlan: ToolchainInstallPlan
  doctor: ToolchainDoctorReport
  androidControlPlane: ToolchainAndroidControlPlaneSnapshot
}

export function createPortableSkillToolchainManifest(skill: SkillDefinition) {
  return createToolchainManifestFromPortableSkill(skill)
}

export function createControlPlaneActionRequest(input: {
  snapshot: ToolchainAndroidControlPlaneSnapshot
  actionKind: ToolchainInstallActionKind
  toolId?: string
  runtimeId?: string
  now?: number
}) {
  return createToolchainControlPlaneActionRequest(input)
}

export function buildControlPlaneCatalogSnapshot(
  input: ToolchainAndroidControlPlaneBuildInput,
): ToolchainControlPlaneCatalogSnapshot {
  const catalogInput = registryBuildInputFromControlPlane(input)
  return {
    registry: buildToolchainRegistrySnapshot(catalogInput),
    installPlan: buildToolchainInstallPlan(catalogInput),
    doctor: buildToolchainDoctorReport(catalogInput),
    androidControlPlane: buildToolchainAndroidControlPlaneSnapshot(input),
  }
}

export async function buildPersistedToolchainCatalogSnapshot(
  input: Omit<ToolchainAndroidControlPlaneBuildInput, 'skills' | 'mcpServers' | 'now'> & { now?: number } = {},
): Promise<ToolchainControlPlaneCatalogSnapshot> {
  const [skills, mcpServers, persistedRegistrationRecords] = await Promise.all([
    listSkills(),
    listMcpServers(),
    loadToolchainRegistrationRecords(),
  ])
  const buildInput = createControlPlaneCatalogBuildInput(input, skills, mcpServers)
  return buildControlPlaneCatalogSnapshot({
    ...buildInput,
    activeTasks: input.activeTasks,
    registrationRecords: input.registrationRecords ?? persistedRegistrationRecords,
    registeredLaunches: input.registeredLaunches,
    gatewaySessions: input.gatewaySessions,
    pairingAcceptances: input.pairingAcceptances,
  })
}

function registryBuildInputFromControlPlane(input: ToolchainAndroidControlPlaneBuildInput): ToolchainRegistryBuildInput {
  return {
    manifests: input.manifests,
    skills: input.skills,
    mcpServers: input.mcpServers,
    runtimes: input.runtimes,
    permissionGrants: input.permissionGrants,
    requestedScopesByToolId: input.requestedScopesByToolId,
    source: input.source,
    projectId: input.projectId,
    now: input.now,
    runtimePreference: input.runtimePreference,
  }
}

export function importRegisteredCatalog(input: unknown): ToolchainRegistrationRecord[] {
  const imported = TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY.importEnvelope(input)
  return imported.ok ? imported.records : []
}

export function exportRegisteredCatalog(input: {
  records: ToolchainRegistrationRecord[]
  source: string
  projectId?: string
  now?: number
}) {
  return TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY.createEnvelope(input)
}

export function applyControlPlaneAction(input: {
  actionRequest: ToolchainControlPlaneActionRequest
  skills: ToolchainAndroidControlPlaneBuildInput['skills']
  mcpServers: ToolchainAndroidControlPlaneBuildInput['mcpServers']
  runtimes?: ToolchainRuntimeSnapshot[]
  existingRegistrationRecords?: ToolchainRegistrationRecord[]
  permissionGrants?: ToolchainPermissionGrant[]
  requestedScopesByToolId?: Record<string, ToolchainScopeRequest>
  payloadsByToolId?: Record<string, Record<string, unknown>>
  runtimePreference?: ToolchainRuntimeKind[]
  now?: number
}): ToolchainControlPlaneActionApplicationResult {
  return applyToolchainControlPlaneAction(input)
}

export async function applyAndPersistToolchainControlPlaneAction(input: {
  actionRequest: ToolchainControlPlaneActionRequest
  runtimes?: ToolchainRuntimeSnapshot[]
  permissionGrants?: ToolchainPermissionGrant[]
  requestedScopesByToolId?: Record<string, ToolchainScopeRequest>
  payloadsByToolId?: Record<string, Record<string, unknown>>
  runtimePreference?: ToolchainRuntimeKind[]
  now?: number
}): Promise<ToolchainControlPlaneActionApplicationResult> {
  const [skills, mcpServers, existingRegistrationRecords] = await Promise.all([
    listSkills(),
    listMcpServers(),
    loadToolchainRegistrationRecords(),
  ])
  const result = applyControlPlaneAction({
    actionRequest: input.actionRequest,
    skills,
    mcpServers,
    runtimes: input.runtimes,
    existingRegistrationRecords,
    permissionGrants: input.permissionGrants,
    requestedScopesByToolId: input.requestedScopesByToolId,
    payloadsByToolId: input.payloadsByToolId,
    runtimePreference: input.runtimePreference,
    now: input.now,
  })
  if (result.ok && result.application?.registrationEnvelope) {
    await writeApplicationDataRecord(
      TOOLCHAIN_CATALOG_STORAGE_KEY,
      result.application.registrationEnvelope,
    )
  }
  return result
}

export function createControlPlaneCatalogBuildInput(
  input: Omit<ToolchainAndroidControlPlaneBuildInput, 'skills' | 'mcpServers' | 'now'> & { now?: number },
  skills: ToolchainAndroidControlPlaneBuildInput['skills'],
  mcpServers: ToolchainAndroidControlPlaneBuildInput['mcpServers'],
): ToolchainRegistryBuildInput {
  const now = Number.isFinite(input.now) && (input.now ?? 0) >= 0 ? Math.floor(input.now as number) : Date.now()
  return {
    manifests: input.manifests,
    skills,
    mcpServers,
    runtimes: input.runtimes,
    permissionGrants: input.permissionGrants,
    requestedScopesByToolId: input.requestedScopesByToolId,
    source: input.source,
    projectId: input.projectId,
    runtimePreference: input.runtimePreference,
    now,
  }
}

async function loadToolchainRegistrationRecords(): Promise<ToolchainRegistrationRecord[]> {
  const persisted = await readApplicationDataRecord<unknown>(TOOLCHAIN_CATALOG_STORAGE_KEY)
  return importRegisteredCatalog(persisted)
}
