import * as Crypto from 'expo-crypto'
import { Platform } from 'react-native'

import {
  BuiltInCapabilityPolicyError,
  createSqliteBuiltInWorkspaceFilePort,
  normalizeWorkspaceRelativePath,
  type BuiltInWorkspaceFilePort,
  type BuiltInWorkspaceFileReadPort,
} from '@/modules/integrations'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { createKnowledgeWorkspaceFileReadPort } from '@/bootstrap/knowledgeWorkspaceFileReadPort'

const BUILT_IN_WORKSPACE_SCOPE_ID = 'islemind-virtual-workspace-v1'

export interface BuiltInWorkspaceFileReadRouterDependencies {
  knowledgeFiles: BuiltInWorkspaceFileReadPort
  workspaceFiles?: BuiltInWorkspaceFilePort
}

export function createBuiltInWorkspaceFileReadRouter(
  dependencies: BuiltInWorkspaceFileReadRouterDependencies,
): BuiltInWorkspaceFileReadPort {
  return {
    workspaceScopeId: BUILT_IN_WORKSPACE_SCOPE_ID,
    inspect(relativePath, options) {
      return resolveWorkspaceFileReadPort(relativePath, dependencies).inspect(relativePath, options)
    },
    readText(relativePath, options) {
      return resolveWorkspaceFileReadPort(relativePath, dependencies).readText(relativePath, options)
    },
  }
}

export const builtInWritableWorkspaceFilePort: BuiltInWorkspaceFilePort | undefined = Platform.OS === 'web'
  ? undefined
  : createSqliteBuiltInWorkspaceFilePort({
      databaseProvider: createExpoSqliteDatabaseProvider(),
      workspaceScopeId: 'islemind-writable-workspace-v1',
      digestText: digestWorkspaceText,
    })

export const builtInWorkspaceFileReadPort = createBuiltInWorkspaceFileReadRouter({
  knowledgeFiles: createKnowledgeWorkspaceFileReadPort(),
  ...(builtInWritableWorkspaceFilePort ? { workspaceFiles: builtInWritableWorkspaceFilePort } : {}),
})

function resolveWorkspaceFileReadPort(
  relativePath: string,
  dependencies: BuiltInWorkspaceFileReadRouterDependencies,
): BuiltInWorkspaceFileReadPort {
  const normalizedPath = normalizeWorkspaceRelativePath(relativePath)
  if (normalizedPath.startsWith('knowledge/')) return dependencies.knowledgeFiles
  if (normalizedPath.startsWith('workspace/') && dependencies.workspaceFiles) return dependencies.workspaceFiles
  throw new BuiltInCapabilityPolicyError(
    'path_outside_workspace',
    'The path is outside the available workspace namespaces.',
  )
}

async function digestWorkspaceText(value: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value,
    { encoding: Crypto.CryptoEncoding.HEX },
  )
}
