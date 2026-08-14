import { systemClock } from '@/core'
import {
  buildConversationChatWorkflowAssistantMessagePatch,
  createConversationChatWorkflowAssistantMessageResolver,
} from '@/modules/conversations'
import { createConversationRagRuntime, createRagQueryPlan } from '@/modules/knowledge'
import { createConversationChatWorkflowRuntimePolicy } from '@/modules/tasks'
import { clampTraceText, projectProcessTrace, redactSensitiveText } from '@/core'

import { androidWorkflowCatalog } from './androidWorkflowCatalog'
import {
  decideConversationChatWorkflowEntry,
  runConversationChatWorkflow,
  type ConversationChatWorkflowEntryInput,
  type ConversationChatWorkflowReply,
} from './conversationChatWorkflowEntry'
import {
  filterLocalSearchToolManifests,
  isBuiltinSearchToolRequest,
  shouldExposeLocalSearchTool,
} from './workflowSearchToolAdmission'
import { listConversationToolManifests, listStaticConversationToolManifests } from './conversationToolCatalog'
import { workflowDefinitionPolicy } from './workflowDefinitions'
import {
  extractWorkflowDefinitionsFromSkillSnapshot,
  hasWorkflowDefinitionCandidatesInSkillSnapshot,
  listBlockedWorkflowStatesForSkillSnapshot,
  listEnabledWorkflowIdsForSkillSnapshot,
} from './workflowSkills'

const projectConversationChatWorkflowAssistantMessage =
  createConversationChatWorkflowAssistantMessageResolver<
    ConversationChatWorkflowEntryInput & { startedAt?: number },
    ConversationChatWorkflowReply
  >({ runWorkflow: runConversationChatWorkflow })

const conversationChatWorkflowRuntimePolicy = createConversationChatWorkflowRuntimePolicy({
  clock: systemClock,
  chatEntry: {
    decideConversationChatWorkflowEntry,
    resolveConversationChatWorkflowAssistantMessage: projectConversationChatWorkflowAssistantMessage,
    buildConversationChatWorkflowAssistantMessagePatch,
  },
  workflows: {
    definitionPolicy: workflowDefinitionPolicy,
    skillPolicy: {
      extractWorkflowDefinitionsFromSkillSnapshot,
      hasWorkflowDefinitionCandidatesInSkillSnapshot,
      listBlockedWorkflowStatesForSkillSnapshot,
      listEnabledWorkflowIdsForSkillSnapshot,
    },
    androidCatalog: androidWorkflowCatalog,
  },
  search: {
    filterLocalSearchToolManifests,
    isBuiltinSearchToolRequest,
    shouldExposeLocalSearchTool,
  },
  tools: {
    listConversationToolManifests,
    listStaticConversationToolManifests,
  },
  rag: {
    createConversationRagRuntime,
    createRagQueryPlan,
  },
  trace: {
    projectTrace: projectProcessTrace,
    redactSensitiveText,
    clampWorkflowOutput: clampTraceText,
  },
})

export const decideConversationChatWorkflowAssistantMessage =
  conversationChatWorkflowRuntimePolicy.decideConversationChatWorkflowAssistantMessage

export const resolveConversationChatWorkflowAssistantMessage =
  conversationChatWorkflowRuntimePolicy.resolveConversationChatWorkflowAssistantMessage
