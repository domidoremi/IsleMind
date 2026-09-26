import * as Crypto from 'expo-crypto'
import { MAX_AGENT_DEFINITION_BYTES } from '@/modules/assistant-runtime'
import { createAgentDefinitionManagement } from '@/modules/assistant-runtime'
import { agentDefinitionRepository } from './agentDefinitionRepository'
import { createAgentDefinitionFileTransfer } from '@/platform/native/agentDefinitionFileTransfer'
import { st } from '@/i18n/service'

/** Management only; this composition does not select, dispatch, grant or start agent execution. */
export const agentDefinitionManagement = createAgentDefinitionManagement({
  repository: agentDefinitionRepository,
  files: createAgentDefinitionFileTransfer({ maxImportBytes: MAX_AGENT_DEFINITION_BYTES, exportDialogTitle: () => st('agents.export') }),
  newId: () => `agent-${Crypto.randomUUID()}`,
})
