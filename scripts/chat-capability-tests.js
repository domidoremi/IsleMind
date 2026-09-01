const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load

registerTypeScriptSupport()

const {
  CHAT_WORKSPACE_RUNTIME_POLICY,
  getChatWorkspaceRuntimePolicy,
} = require('../src/modules/workspaces/index.ts')
const {
  CHAT_PRESENTATION_CATALOG,
} = require('../src/presentation/features/chat/chatPresentationCatalog.ts')
const {
  CHAT_MEDIA_GENERATION_ADAPTER_GATES,
  CHAT_MEDIA_GENERATION_ENTRIES,
  CHAT_MULTIMODAL_ENTRIES,
  getChatMediaGenerationGateMetadata,
  resolveChatMultimodalPolicy,
  summarizeChatMediaGenerationGateReadiness,
} = require('../src/presentation/features/chat/chatMultimodalPolicy.ts')
const {
  getChatBoundaryStatusActionMetadata,
  resolveChatBoundaryStatusAction,
} = require('../src/presentation/features/chat/chatBoundaryStatus.ts')
const {
  CHAT_EMPTY_STATE_MIN_TOUCH_TARGET,
  presentChatEmptyStateBoundaryAction,
  resolveChatConversationEmptyStateMinHeight,
  resolveChatEmptyStateProjection,
} = loadChatEmptyStateContract()
const { createWorkflowToolPermissionPolicy } = require('../src/modules/tasks/index.ts')
const {
  decideToolPermission,
  annotateManifestExecutionPolicy,
  resolveManifestExecutionPolicy,
  resolveToolPermissionEvidence,
  validateToolInputSchema,
} = require('../src/modules/integrations/index.ts')

const { decideWorkflowToolPermission } = createWorkflowToolPermissionPolicy({
  now: () => 1910000001000,
  projectTrace: (trace) => ({
    ...trace,
    completedAt: trace.startedAt,
    durationMs: 0,
  }),
  decidePermission: decideToolPermission,
  resolveEvidence: resolveToolPermissionEvidence,
  resolveExecutionPolicy: resolveManifestExecutionPolicy,
  validateInput: validateToolInputSchema,
})

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isChatCapabilityHook) return

  Module._load = function loadWithRuntimeStubs(request, parent, isMain) {
    if (request === 'react-native') {
      return { NativeModules: {}, Platform: { OS: 'test' } }
    }
    if (request === 'moti') {
      return { MotiView: 'MotiView' }
    }
    if (request === 'expo-file-system/legacy') {
      return {
        cacheDirectory: null,
        StorageAccessFramework: {
          getUriForDirectoryInRoot: (directory) => `content://test/${directory}`,
          requestDirectoryPermissionsAsync: async () => ({ granted: false }),
        },
        readDirectoryAsync: async () => [],
      }
    }
    if (request === 'expo-intent-launcher') {
      return {}
    }
    if (request === 'expo-crypto') {
      return {
        CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
        digestStringAsync: async () => 'test-only-sha256',
      }
    }
    if (request === 'expo-sqlite') {
      return {
        openDatabaseAsync: async () => {
          throw new Error('expo-sqlite is unavailable in the Node Chat capability harness')
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isChatCapabilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
  require.extensions['.png'] = (module, filename) => {
    module.exports = filename
  }
}

function loadChatEmptyStateContract() {
  const activeLoad = Module._load
  Module._load = function loadChatEmptyStateMocks(request, parent, isMain) {
    if (request === 'react-native') {
      return {
        Platform: { OS: 'test' },
        Text: 'Text',
        View: 'View',
        useWindowDimensions: () => ({ width: 320, height: 568 }),
      }
    }
    if (request === 'react-i18next') {
      return { useTranslation: () => ({ t: (key) => key }) }
    }
    if (request === '@/components/navigation/AnimatedNavigationIcon') {
      return { AnimatedNavigationIcon: 'AnimatedNavigationIcon' }
    }
    if (request === '@/components/navigation/AnimatedNavigationTrigger') {
      return { useNavigationTrigger: (trigger) => ({ active: false, trigger }) }
    }
    if (request === '@/components/ui/AppIcon') {
      return { AppIcon: 'AppIcon', appIconStroke: { fine: 1, strong: 2 } }
    }
    if (request === '@/components/ui/isle') {
      return {
        IslePressable: 'IslePressable',
        useIsleDialog: () => ({
          confirm: async () => false,
          notice: () => undefined,
        }),
      }
    }
    if (request === '@/hooks/useAppTheme') {
      return {
        useAppTheme: () => ({
          colors: {
            text: '#000',
            textSecondary: '#111',
            textTertiary: '#222',
            ui: { icon: { accentForeground: '#333' } },
          },
        }),
      }
    }
    return activeLoad.call(this, request, parent, isMain)
  }

  try {
    return require('../src/components/chat/ChatEmptyState.tsx')
  } finally {
    Module._load = activeLoad
  }
}

function sampleTool(overrides) {
  return {
    id: overrides.id ?? `test:${overrides.name}`,
    source: overrides.source ?? 'builtin',
    name: overrides.name,
    description: overrides.description ?? overrides.name,
    permission: overrides.permission ?? 'read-only',
    enabled: overrides.enabled ?? true,
    metadata: overrides.metadata,
    riskLevel: overrides.riskLevel,
    requiresConfirmation: overrides.requiresConfirmation,
    outputBoundary: overrides.outputBoundary,
  }
}

const BASE_PROVIDER_CAPABILITIES = {
  chat: true,
  streaming: true,
  modelList: true,
  vision: false,
  files: false,
  audioInput: false,
  audioTranscription: false,
  speech: false,
  nativeSearch: false,
  reasoningEffort: false,
  nativeTools: false,
  topP: true,
  embeddings: false,
  rerank: false,
  responsesApi: false,
  responsesWebSocket: false,
  remoteCompact: false,
  payloadPolicy: true,
}

function sampleProvider(overrides = {}) {
  const model = overrides.model ?? 'test-omni'
  return {
    id: overrides.id ?? 'test-provider',
    name: overrides.name ?? 'Test Provider',
    type: overrides.type ?? 'openai',
    apiKey: 'test-key',
    baseUrl: overrides.baseUrl ?? 'https://api.openai.com/v1',
    capabilities: { ...BASE_PROVIDER_CAPABILITIES, ...(overrides.capabilities ?? {}) },
    models: overrides.models ?? [model],
    modelConfigs: overrides.modelConfigs ?? [sampleModel(model, overrides.modelConfig)],
    enabled: overrides.enabled ?? true,
  }
}

function sampleModel(id, overrides = {}) {
  return {
    id,
    name: id,
    provider: overrides.provider ?? 'openai',
    contextWindow: 128000,
    maxTokens: 128000,
    maxOutputTokens: 4096,
    defaultMaxTokens: 2048,
    supportsVision: overrides.supportsVision ?? true,
    supportsFiles: overrides.supportsFiles ?? true,
    supportsStreaming: true,
    source: 'remote',
    ...overrides,
  }
}

function readResource(locale) {
  return JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/resources', `${locale}.json`), 'utf8'))
}

function readKey(resource, key) {
  return key.split('.').reduce((current, segment) => current?.[segment], resource)
}

function assertLocalizedKey(locales, key, label) {
  for (const [locale, resource] of Object.entries(locales)) {
    const value = readKey(resource, key)
    assert.equal(typeof value, 'string', `${label} is localized in ${locale}: ${key}`)
    assert.ok(value.trim().length > 0, `${label} is non-empty in ${locale}: ${key}`)
  }
}

function assertChatPresentationCatalog() {
  const locales = {
    en: readResource('en'),
    'zh-CN': readResource('zh-CN'),
    ja: readResource('ja'),
  }
  const definition = CHAT_PRESENTATION_CATALOG
  assert.equal(definition.id, 'chat', 'the active presentation catalog owns only Chat')
  for (const key of [
    definition.labelKey,
    definition.setupDescriptionKey,
    definition.emptyTitleKey,
    definition.emptyDescriptionKey,
    definition.systemPromptPlaceholderKey,
    definition.boundary.titleKey,
    definition.boundary.descriptionKey,
    definition.boundary.handoffKey,
    definition.memory.titleKey,
    definition.memory.summaryKey,
    definition.memory.visibilityKey,
  ]) {
    assertLocalizedKey(locales, key, 'Chat presentation copy')
  }
  const starters = definition.starters
  assert.equal(starters.length, 3, 'Chat exposes three mobile starter actions')
  assert.equal(new Set(starters.map((starter) => starter.id)).size, starters.length, 'Chat starter ids are unique')
  for (const starter of starters) {
    assert.ok(/^[a-z][a-z0-9-]*$/.test(starter.id), `${starter.id} Chat starter id is stable`)
    assert.ok(starter.glyph, `${starter.id} Chat starter declares an icon glyph`)
    assertLocalizedKey(locales, starter.titleKey, `${starter.id} Chat starter title`)
    assertLocalizedKey(locales, starter.descriptionKey, `${starter.id} Chat starter description`)
    assertLocalizedKey(locales, starter.promptKey, `${starter.id} Chat editable starter draft`)
  }
  assert.equal(definition.cues.length, 3, 'Chat exposes three lightweight cues')
  assert.equal(new Set(definition.cues.map((cue) => cue.id)).size, definition.cues.length, 'Chat cue ids are unique')
  assert.ok(definition.boundary.handoffKey.includes('.boundary.handoff'), 'Chat boundary declares visible handoff copy')
  assert.equal(definition.memory.scope, 'conversation-local', 'Chat memory presentation is conversation-local')
  const catalogSource = fs.readFileSync(path.join(root, 'src/presentation/features/chat/chatPresentationCatalog.ts'), 'utf8')
  assertLocalizedKey(locales, 'chatPresentation.boundaryAccessibilityLabelWithStatus', 'Chat boundary accessibility label with media readiness')
  assertLocalizedKey(locales, 'chatPresentation.boundaryStatusAccessibilityHint', 'Chat boundary status explanation hint')
  assertLocalizedKey(locales, 'chatPresentation.boundaryStatusNoticeTitle', 'Chat boundary status explanation title')
  assertLocalizedKey(locales, 'chatPresentation.boundaryStatusNoticeMessage', 'Chat boundary status explanation body')
  assertLocalizedKey(locales, 'chatPresentation.boundaryStatusProviderAction', 'Chat boundary status provider action')
  assertLocalizedKey(locales, 'chatPresentation.boundaryStatusMemoryAction', 'Chat boundary status memory action')
  assertLocalizedKey(locales, 'chatPresentation.boundaryStatusToolsAction', 'Chat boundary status input tools action')
  assertLocalizedKey(locales, 'chatPresentation.boundaryStatusDetailsAction', 'Chat boundary status details action')
  assertLocalizedKey(locales, 'chatPresentation.memoryStatusLabel', 'Chat memory status label')
  assertLocalizedKey(locales, 'chatPresentation.mediaStatusLabel', 'Chat media readiness status label')
  assertLocalizedKey(locales, 'chatPresentation.generationLockedStatusLabel', 'Chat future generation gate status label')
  assertLocalizedKey(locales, 'chatPresentation.generationReadyStatusLabel', 'Chat generation ready status label')
  assertLocalizedKey(locales, 'chat.firstRunProviderSetupDescription', 'Chat first-run provider setup guidance')
  assertLocalizedKey(locales, 'chat.connectProvider', 'Chat first-run provider action')
  for (const gate of CHAT_MEDIA_GENERATION_ADAPTER_GATES) {
    assertLocalizedKey(locales, gate.labelKey, 'mode future generation gate label')
  }

  const chatWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspace.tsx'), 'utf8')
  const chatSetupWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatSetupWorkspace.tsx'), 'utf8')
  const floatingComposerSource = fs.readFileSync(path.join(root, 'src/components/chat/FloatingComposer.tsx'), 'utf8')
  const chatEmptyStateSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatEmptyState.tsx'), 'utf8')
  const animatedNavigationIconSource = fs.readFileSync(path.join(root, 'src/components/navigation/AnimatedNavigationIcon.tsx'), 'utf8')
  const appIconSource = fs.readFileSync(path.join(root, 'src/components/ui/AppIcon.tsx'), 'utf8')
  const providerKeyIconSource = fs.readFileSync(path.join(root, 'node_modules/lucide-react-native/dist/cjs/icons/key-square.js'), 'utf8')
  assert.doesNotMatch(chatEmptyStateSource, /ProductInteractionMode|PRODUCT_MODE_SHOW_EMPTY_STATE_CONTENT|\bagent\b|\bcompanion\b/, 'the rendered empty state has no historical runtime-mode branch')
  assert.ok(chatEmptyStateSource.includes('accessibilityLabel={actionLabel}') && chatEmptyStateSource.includes('accessibilityHint={actionHint}') && chatEmptyStateSource.includes('onPress={navigation.trigger}'), 'provider recovery preserves its accessible command contract')
  assert.ok(animatedNavigationIconSource.includes("'provider-key': 'provider-key'"), 'navigation preserves the semantic provider-key glyph through AppIcon')
  assert.ok(chatSetupWorkspaceSource.includes("t('chat.firstRunProviderSetupDescription')"), 'the no-provider setup surface explains the shortest path to a working chat')
  assert.ok(chatSetupWorkspaceSource.includes('actionLabel={setupActionLabel}'), 'the setup surface exposes one contextual primary provider action')
  assert.ok(chatSetupWorkspaceSource.includes("actionHint={setupNeedsConfiguration ? t('chat.configureProvidersAccessibilityHint') : undefined}") && chatSetupWorkspaceSource.includes("glyph={setupNeedsConfiguration ? 'provider-key' : undefined}"), 'the first-run action keeps an accessible hint and semantic provider glyph')
  assert.ok(chatSetupWorkspaceSource.includes('onInspectProvider={openAiConfiguration}'), 'the setup boundary and composer share the in-context AI configuration route')
  assert.ok(chatSetupWorkspaceSource.includes('onAction={setupNeedsConfiguration ? openAiConfiguration : undefined}'), 'the first-run CTA reuses the in-context AI configuration sheet without adding a new route')
  assert.equal(CHAT_EMPTY_STATE_MIN_TOUCH_TARGET, 44, 'empty-state provider, starter, and status actions share the accessible mobile touch target')
  assert.equal((appIconSource.match(/'provider-key': KeySquare,/g) ?? []).length, 1, 'the canonical AppIcon registry maps provider-key to the path-only KeySquare glyph')
  assert.ok(appIconSource.includes('const appIconRegistry = {'), 'AppIcon uses one semantic glyph registry across themes')
  assert.doesNotMatch(
    appIconSource,
    /import\s+(?!type\b)[\s\S]*?from 'lucide-react-native'/,
    'AppIcon avoids the Lucide root barrel so Metro does not load every icon module',
  )
  assert.ok(appIconSource.includes("from 'lucide-react-native/icons/"), 'AppIcon loads only registered Lucide glyph modules')
  assert.equal((appIconSource.match(/\bkey: Key,/g) ?? []).length, 1, 'the canonical key glyph keeps its mapping')
  assert.doesNotMatch(appIconSource, /'provider-key': Key,/, 'provider-key does not restore the Circle-backed generic Key glyph')
  assert.match(providerKeyIconSource, /\["path",/, 'the pinned provider-key glyph contains path nodes')
  assert.doesNotMatch(providerKeyIconSource, /\["circle",/, 'the pinned provider-key glyph does not mount an RNSVGCircle node')
  assert.equal(fs.existsSync(path.join(root, 'src/components/chat/FloatingControlOrb.tsx')), false, 'Chat keeps one Composer-owned toolbox authority')
  assert.equal(fs.existsSync(path.join(root, 'src/components/chat/chatControlOrbActions.ts')), false, 'retired floating toolbox actions stay deleted')
  assert.ok(floatingComposerSource.includes("label={t('chat.quickTools')}") && floatingComposerSource.includes("onPanelChange(quickPanelOpen ? null : 'more')"), 'Composer owns the remaining contextual tools entry')
  assert.equal(resolveChatConversationEmptyStateMinHeight(-120), 0, 'keyboard-constrained empty state clamps a negative available height')
  assert.equal(resolveChatConversationEmptyStateMinHeight(188), 188, 'empty state preserves a positive short-height message region without fixing its height')
  assert.ok(!chatWorkspaceSource.includes('const PRODUCT_MODE_STARTERS ='), 'ChatWorkspace does not own product starter metadata')
  assert.ok(!chatWorkspaceSource.includes('const PRODUCT_MODE_CUES ='), 'ChatWorkspace does not own product cue metadata')
  assert.ok(!chatWorkspaceSource.includes('const PRODUCT_MODE_BOUNDARIES ='), 'ChatWorkspace does not own product boundary metadata')
  assert.ok(!chatWorkspaceSource.includes('const PRODUCT_MODE_MEMORY ='), 'ChatWorkspace does not own product memory metadata')
  assert.ok(chatEmptyStateSource.includes('onApplyStarter(t(primaryStarter.promptKey), [], true)'), 'the primary Chat starter inserts an editable draft instead of auto-sending')
  assert.ok(!chatWorkspaceSource.includes('onPress={() => onApplyStarter(t(cue.labelKey)'), 'mode cues are informational and do not auto-send prompts')
  assert.ok(chatWorkspaceSource.includes('resolveChatMultimodalPolicy'), 'ChatWorkspace resolves Chat multimodal policy from the selected provider/model')
  assert.ok(chatWorkspaceSource.includes('multimodalPolicy={runtimeMultimodalPolicy}'), 'runtime composer receives capability-gated multimodal policy')
  assert.ok(
    chatSetupWorkspaceSource.includes('multimodalPolicy={setupState.setupMultimodalPolicy}'),
    'setup composer receives capability-gated multimodal policy',
  )

  const composerSource = fs.readFileSync(path.join(root, 'src/components/chat/Composer.tsx'), 'utf8')
  assert.ok(composerSource.includes('multimodalPolicy?.unavailableCount'), 'Composer keeps capability-aware media control state when entries are unavailable')
  assert.equal(composerSource.includes('generationGateCount'), false, 'Composer does not render the removed future media generation gate paragraph')
  assert.equal(composerSource.includes('generationGateSummary'), false, 'Composer leaves future media generation gate names in the action-triggered boundary details')
  assert.equal(composerSource.includes('generationReadinessSummary'), false, 'Composer leaves future media generation readiness counts in the action-triggered boundary details')
  assert.equal(composerSource.includes('multimodalCapabilityNoticeWithGenerationGate'), false, 'Composer omits the removed image/video generation threshold copy')
  assert.ok(composerSource.includes("disabled={!isMultimodalEntryAvailable('image')}"), 'Composer disables image affordances through Chat multimodal policy')
  assert.ok(composerSource.includes("disabled={!isMultimodalEntryAvailable('file')}"), 'Composer disables file affordances through Chat multimodal policy')
  assert.ok(composerSource.includes("!recording && !isMultimodalEntryAvailable('voice')"), 'Composer disables voice affordances through Chat multimodal policy')
  assert.ok(composerSource.includes('hasBlockedAttachment'), 'Composer blocks sending draft attachments that become unsupported after a mode/model change')

  const multimodalCopyKeys = [
    'chat.multimodalCapabilityNotice',
    'chat.multimodalUnavailableGeneric',
    'chat.multimodalUnavailableNoProvider',
    'chat.multimodalUnavailableImage',
    'chat.multimodalUnavailableFile',
    'chat.multimodalUnavailableVoice',
    'chat.multimodalUnavailableCompanionFiles',
    'chat.multimodalCapabilityNoticeWithGenerationGate',
    'chat.multimodalGenerationAdapterRequired',
  ]
  for (const key of multimodalCopyKeys) {
    assertLocalizedKey(locales, key, 'multimodal capability gate copy')
  }
}

async function assertChatMultimodalPolicy() {
  const resolveProviderCapabilityManifest = ({ provider, model }) => {
    const modelConfig = provider.modelConfigs?.find((item) => item.id === model)
    return {
      modalities: {
        input: {
          text: true,
          image: modelConfig?.supportsVision === true,
          file: modelConfig?.supportsFiles === true,
          audio: provider.capabilities?.audioInput === true,
          video: false,
        },
        output: {
          text: true,
          speech: provider.capabilities?.speech === true,
        },
      },
    }
  }
  assert.deepEqual(CHAT_MULTIMODAL_ENTRIES, ['image', 'camera', 'file', 'voice'], 'mobile multimodal entries cover image, camera, file, and voice')
  assert.deepEqual(CHAT_MEDIA_GENERATION_ENTRIES, ['image-generation', 'video-generation'], 'future media generation entries cover image and video generation gates')
  assert.deepEqual(
    CHAT_MEDIA_GENERATION_ADAPTER_GATES.map((gate) => gate.id),
    ['provider-capability-evidence', 'generation-adapter', 'artifact-manifest', 'retention-cleanup', 'cancellation-semantics', 'native-mobile-proof'],
    'future media generation gates cover provider evidence, adapter, artifact, retention, cancellation, and native proof'
  )
  assert.deepEqual(
    CHAT_MEDIA_GENERATION_ADAPTER_GATES.map((gate) => gate.labelKey),
    [
      'chatPresentation.generationGateLabels.providerCapabilityEvidence',
      'chatPresentation.generationGateLabels.generationAdapter',
      'chatPresentation.generationGateLabels.artifactManifest',
      'chatPresentation.generationGateLabels.retentionCleanup',
      'chatPresentation.generationGateLabels.cancellationSemantics',
      'chatPresentation.generationGateLabels.nativeMobileProof',
    ],
    'future media generation gates expose localized labels instead of hard-coded composer copy'
  )
  assert.deepEqual(
    CHAT_MEDIA_GENERATION_ADAPTER_GATES.map((gate) => gate.readiness),
    CHAT_MEDIA_GENERATION_ADAPTER_GATES.map(() => 'required-before-default'),
    'future media generation gates explicitly remain required before default enablement',
  )
  assert.ok(
    CHAT_MEDIA_GENERATION_ADAPTER_GATES.every((gate) => gate.blocksDefaultEnablement === true),
    'future media generation gates all block default enablement until verified',
  )
  assert.equal(
    getChatMediaGenerationGateMetadata('native-mobile-proof').labelKey,
    'chatPresentation.generationGateLabels.nativeMobileProof',
    'future media generation gate metadata can be resolved by id'
  )
  assert.deepEqual(
    summarizeChatMediaGenerationGateReadiness(CHAT_MEDIA_GENERATION_ADAPTER_GATES.map((gate) => gate.id)),
    {
      ready: 0,
      total: 6,
      blockedGateIds: CHAT_MEDIA_GENERATION_ADAPTER_GATES.map((gate) => gate.id),
    },
    'future media generation readiness summary starts at 0/6 and names every blocking gate',
  )

  const capableProvider = sampleProvider({
    capabilities: { vision: true, files: true, audioTranscription: true },
    modelConfig: { supportsVision: true, supportsFiles: true },
  })
  const chatPolicy = resolveChatMultimodalPolicy({ provider: capableProvider, model: 'test-omni', resolveProviderCapabilityManifest })
  assert.equal(chatPolicy.memoryScope, 'conversation', 'Chat multimodal policy uses conversation memory')
  assert.equal(chatPolicy.unavailableCount, 0, 'capable Chat provider exposes all multimodal entries')
  assert.equal(chatPolicy.generationUnavailableCount, 2, 'future image/video generation remains locked even with a capable input provider')
  assert.deepEqual(
    chatPolicy.generationGateIds,
    CHAT_MEDIA_GENERATION_ADAPTER_GATES.map((gate) => gate.id),
    'policy exposes the shared future media generation readiness gate ids'
  )
  assert.deepEqual(
    chatPolicy.generationGateReadinessSummary,
    {
      ready: 0,
      total: 6,
      blockedGateIds: chatPolicy.generationGateIds,
    },
    'policy exposes the current 0/6 readiness state instead of a count-only hidden lock',
  )
  for (const entry of CHAT_MULTIMODAL_ENTRIES) {
    assert.equal(chatPolicy.entries[entry].available, true, `Chat exposes ${entry} when provider/model declares support`)
    assert.equal(chatPolicy.entries[entry].source, 'provider-capability-manifest', `${entry} availability comes from provider conformance manifest`)
  }
  for (const entry of CHAT_MEDIA_GENERATION_ENTRIES) {
    assert.equal(chatPolicy.generationEntries[entry].available, false, `${entry} stays disabled until the generation adapter contract is implemented`)
    assert.equal(chatPolicy.generationEntries[entry].requirement, 'media-generation-adapter', `${entry} requires the generation adapter contract`)
    assert.equal(chatPolicy.generationEntries[entry].source, 'adapter-required', `${entry} is blocked by adapter readiness, not by a hidden UI toggle`)
    assert.equal(chatPolicy.generationEntries[entry].reasonKey, 'chat.multimodalGenerationAdapterRequired', `${entry} has localized adapter-gate copy`)
    assert.deepEqual(chatPolicy.generationEntries[entry].adapterGateIds, chatPolicy.generationGateIds, `${entry} declares the full readiness gate checklist`)
    assert.ok(chatPolicy.generationEntries[entry].adapterGateIds.includes('native-mobile-proof'), `${entry} requires native proof before default UI enablement`)
  }

  const textProvider = sampleProvider({
    id: 'text-provider',
    name: 'Text Provider',
    model: 'text-only',
    capabilities: { vision: false, files: false, audioTranscription: false },
    modelConfig: { supportsVision: false, supportsFiles: false },
  })
  const blockedPolicy = resolveChatMultimodalPolicy({ provider: textProvider, model: 'text-only', resolveProviderCapabilityManifest })
  assert.equal(blockedPolicy.entries.image.available, false, 'image entry is disabled when model lacks image input')
  assert.equal(blockedPolicy.entries.camera.available, false, 'camera entry is disabled with image input capability')
  assert.equal(blockedPolicy.entries.file.available, false, 'file entry is disabled when model lacks file input')
  assert.equal(blockedPolicy.entries.voice.available, false, 'voice entry is disabled when provider lacks transcription')
  assert.equal(blockedPolicy.entries.image.reasonKey, 'chat.multimodalUnavailableImage', 'image disable reason is localized')
  assert.equal(blockedPolicy.entries.file.reasonKey, 'chat.multimodalUnavailableFile', 'file disable reason is localized')
  assert.equal(blockedPolicy.entries.voice.reasonKey, 'chat.multimodalUnavailableVoice', 'voice disable reason is localized')

  const missingProviderPolicy = resolveChatMultimodalPolicy({ provider: null, model: null, resolveProviderCapabilityManifest })
  assert.equal(missingProviderPolicy.unavailableCount, CHAT_MULTIMODAL_ENTRIES.length, 'missing provider disables all multimodal entries')
  assert.equal(missingProviderPolicy.generationUnavailableCount, CHAT_MEDIA_GENERATION_ENTRIES.length, 'missing provider also keeps future generation entries locked')
  assert.ok(CHAT_MULTIMODAL_ENTRIES.every((entry) => missingProviderPolicy.entries[entry].source === 'provider-missing'), 'missing provider reasons are explicit')

  const providerProjection = resolveChatEmptyStateProjection({
    multimodalPolicy: missingProviderPolicy,
    memoryStatus: { active: 3, pending: 2 },
  })
  assert.equal(providerProjection.action.action, 'provider', 'Chat empty state prioritizes provider recovery for provider-fixable media gaps')
  assert.equal(providerProjection.mediaReady, 0, 'Chat empty state reports no ready media inputs without a provider')
  assert.equal(providerProjection.mediaTotal, CHAT_MULTIMODAL_ENTRIES.length, 'Chat empty state reports the complete media readiness denominator')

  const memoryProjection = resolveChatEmptyStateProjection({
    multimodalPolicy: chatPolicy,
    memoryStatus: { active: 4, pending: 2 },
  })
  assert.equal(memoryProjection.action.action, 'memory', 'Chat empty state routes pending conversation memory to review when provider inputs are ready')
  assert.deepEqual(memoryProjection.memoryStatus, { active: 4, pending: 2 }, 'Chat empty state retains active and pending memory counts for its accessible summary')

  const toolsProjection = resolveChatEmptyStateProjection({
    multimodalPolicy: chatPolicy,
    memoryStatus: { active: 4, pending: 0 },
  })
  assert.equal(toolsProjection.action.action, 'tools', 'Chat empty state routes diagnostic-only generation readiness to composer tools')
  assert.equal(toolsProjection.generationReady, 0, 'Chat empty state exposes the current generation readiness numerator')
  assert.equal(toolsProjection.generationTotal, CHAT_MEDIA_GENERATION_ADAPTER_GATES.length, 'Chat empty state exposes the generation readiness denominator')
  assert.deepEqual(toolsProjection.generationGateIds, chatPolicy.generationGateIds, 'Chat empty state retains named generation gate identities')
  assert.equal(toolsProjection.primaryStarter?.id, 'ask', 'Chat empty state always exposes the primary Chat starter')
  assert.deepEqual(
    toolsProjection.accessibility,
    {
      role: 'button',
      minimumTouchTarget: 44,
      labelKey: 'chatPresentation.boundaryAccessibilityLabelWithStatus',
      hintKey: 'chatPresentation.boundaryStatusAccessibilityHint',
    },
    'Chat empty state projects the accessible status-action contract consumed by rendering',
  )

  const noticeProjection = resolveChatEmptyStateProjection({
    multimodalPolicy: null,
    memoryStatus: { active: 0, pending: 0 },
  })
  assert.equal(noticeProjection.action.action, 'notice', 'Chat empty state falls back to a non-mutating readiness notice')

  const actionCalls = []
  const dialogCalls = []
  const confirmedDialog = {
    async confirm(input) {
      dialogCalls.push({ kind: 'confirm', input })
      return true
    },
    notice(input) {
      dialogCalls.push({ kind: 'notice', input })
    },
  }
  const presentAction = (action, callbackName, callback) => presentChatEmptyStateBoundaryAction({
    action,
    dialog: confirmedDialog,
    title: 'Chat readiness',
    message: 'Current readiness details',
    actionLabel: callbackName,
    doneLabel: 'Done',
    [callbackName]: callback,
  })
  await presentAction('provider', 'onInspectProvider', async () => {
    await Promise.resolve()
    actionCalls.push('provider')
  })
  await presentAction('memory', 'onOpenMemory', async () => {
    await Promise.resolve()
    actionCalls.push('memory')
  })
  await presentAction('tools', 'onOpenTools', async () => {
    await Promise.resolve()
    actionCalls.push('tools')
  })
  await presentChatEmptyStateBoundaryAction({
    action: 'notice',
    dialog: confirmedDialog,
    title: 'Chat readiness',
    message: 'Current readiness details',
    actionLabel: 'Details',
    doneLabel: 'Done',
  })
  assert.deepEqual(actionCalls, ['provider', 'memory', 'tools'], 'confirmed Chat empty-state actions await and invoke provider, memory, and tools navigation')
  assert.deepEqual(dialogCalls.map((entry) => entry.kind), ['confirm', 'confirm', 'confirm', 'notice'], 'Chat empty-state action dispatch confirms navigation and uses a non-mutating notice otherwise')

  const providerBoundaryAction = resolveChatBoundaryStatusAction({
      multimodalPolicy: missingProviderPolicy,
      pendingMemoryCount: 4,
      canInspectProvider: true,
      canOpenMemory: true,
      canOpenTools: true,
    })
  assert.equal(
    providerBoundaryAction,
    'provider',
    'boundary status prioritizes provider-fixable media gaps before memory review'
  )
  assert.deepEqual(
    getChatBoundaryStatusActionMetadata(providerBoundaryAction),
    {
      action: 'provider',
      labelKey: 'chatPresentation.boundaryStatusProviderAction',
      glyph: 'provider-key',
      requiresConfirmation: true,
    },
    'provider-fixable boundary gaps expose provider-review metadata for compact UI affordances'
  )
  assert.equal(
    getChatBoundaryStatusActionMetadata(resolveChatBoundaryStatusAction({
      multimodalPolicy: chatPolicy,
      pendingMemoryCount: 2,
      canInspectProvider: true,
      canOpenMemory: true,
      canOpenTools: true,
    })).glyph,
    'memory-brain',
    'boundary status routes pending Chat memory to the visible memory-review affordance when provider inputs are ready'
  )
  assert.equal(
    getChatBoundaryStatusActionMetadata(resolveChatBoundaryStatusAction({
      multimodalPolicy: null,
      pendingMemoryCount: 0,
      canInspectProvider: true,
      canOpenMemory: true,
      canOpenTools: true,
    })).requiresConfirmation,
    false,
    'boundary status falls back to a notice-only explanation when no action is useful'
  )
}

async function run() {
  assertChatPresentationCatalog()
  await assertChatMultimodalPolicy()

  const chatRuntimePolicy = getChatWorkspaceRuntimePolicy()
  assert.strictEqual(chatRuntimePolicy, CHAT_WORKSPACE_RUNTIME_POLICY, 'Chat workspace policy returns the frozen canonical identity')
  assert.deepEqual(chatRuntimePolicy, {
    runtimeKind: 'conversation',
    memoryScope: 'conversation',
    canRunInParallel: true,
  }, 'Chat workspace policy exposes no Agent or Tavern runtime branch')
  assert.equal(Object.isFrozen(chatRuntimePolicy), true, 'Chat workspace policy is immutable')
  assert.throws(
    () => getChatWorkspaceRuntimePolicy('companion'),
    /does not accept a historical product mode/,
    'historical modes cannot regain workspace runtime authority',
  )

  const readOnly = sampleTool({ name: 'context.read' })
  const readOnlyPolicy = resolveManifestExecutionPolicy(readOnly)
  assert.equal(readOnlyPolicy.riskLevel, 'low', 'read-only builtins are low risk')
  assert.equal(readOnlyPolicy.requiresConfirmation, false, 'read-only low-risk tools do not need confirmation')

  const workArtifact = sampleTool({ id: 'work-artifact:summarize', source: 'work-artifact', name: 'work_artifact.summarize' })
  const workArtifactPolicy = resolveManifestExecutionPolicy(workArtifact)
  assert.equal(workArtifactPolicy.outputBoundary, 'agent-trace', 'work artifacts emit into the Agent trace boundary')

  const writeTool = sampleTool({ name: 'set_language', source: 'app-action', permission: 'read-write' })
  const writePolicy = resolveManifestExecutionPolicy(writeTool)
  assert.equal(writePolicy.requiresConfirmation, true, 'read-write tools require confirmation or visible intent')

  const androidRead = sampleTool({ name: 'android.files.scan', source: 'android', permission: 'read-only' })
  const androidReadPolicy = resolveManifestExecutionPolicy(androidRead)
  assert.equal(androidReadPolicy.riskLevel, 'sensitive-read', 'Android read tools are treated as sensitive reads')
  assert.equal(androidReadPolicy.outputBoundary, 'external-system', 'Android tools use an external-system output boundary')

  const missingEvidenceDecisions = [undefined, 'chat', 'agent', 'companion'].map((mode) =>
    decideWorkflowToolPermission(writeTool, { ...(mode ? { mode } : {}), intentVisible: true }))
  assert.ok(missingEvidenceDecisions.every((decision) => decision.decision === 'confirm'), 'product mode cannot bypass the read-write evidence gate')
  assert.ok(missingEvidenceDecisions.every((decision) => decision.code === 'evidence_insufficient'), 'missing evidence remains explicit for every historical mode input')

  const evidenceContext = {
    intentVisible: true,
    evidenceSources: ['agent-plan:test', 'source:visible-agent-request'],
    evidenceSummary: 'Visible plan reviewed before execution.',
  }
  const admittedDecisions = [undefined, 'chat', 'agent', 'companion'].map((mode) =>
    decideWorkflowToolPermission(writeTool, { ...evidenceContext, ...(mode ? { mode } : {}) }))
  assert.ok(admittedDecisions.every((decision) => decision.decision === 'allow'), 'Chat and historical mode inputs admit the same evidence-backed read-write action')
  assert.ok(admittedDecisions.every((decision) => decision.trace.metadata?.riskLevel === 'state-changing'), 'permission traces retain tool risk')
  assert.ok(admittedDecisions.every((decision) => decision.trace.metadata?.evidenceReady === true), 'permission traces retain evidence readiness')

  const destructiveTool = sampleTool({ name: 'danger.delete', permission: 'destructive' })
  const destructiveConfirmation = [undefined, 'chat', 'agent', 'companion'].map((mode) =>
    decideWorkflowToolPermission(destructiveTool, mode ? { mode } : {}))
  assert.ok(destructiveConfirmation.every((decision) => decision.decision === 'confirm'), 'destructive execution always requires confirmation under the default ceiling')
  assert.ok(destructiveConfirmation.every((decision) => decision.code === 'permission_required'), 'destructive confirmation remains explicit for every historical mode input')

  const annotated = annotateManifestExecutionPolicy({
    ...readOnly,
    supportedModes: ['agent'],
    metadata: { modePolicyReason: 'obsolete mode policy', retained: true },
  })
  assert.equal('supportedModes' in annotated, false, 'neutral annotation strips historical supported-mode authority')
  assert.equal(annotated.outputBoundary, 'mode-session', 'annotated read-only tools declare output boundary')
  assert.equal('modePolicyReason' in annotated.metadata, false, 'neutral annotation strips obsolete mode-policy copy')
  assert.equal(annotated.metadata?.retained, true, 'neutral annotation preserves unrelated metadata')
  assert.match(annotated.metadata?.executionPolicyReason ?? '', /\S/, 'annotated tools explain neutral execution policy')

  const catalogBindingSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationToolCatalog.ts'), 'utf8')
  const targetCatalogSource = fs.readFileSync(path.join(root, 'src/modules/integrations/conversationToolCatalog.ts'), 'utf8')
  assert.ok(targetCatalogSource.includes('annotateManifestExecutionPolicy'), 'target integration catalog annotates manifests with neutral execution policy')
  assert.equal(targetCatalogSource.includes('filterAgentToolManifestsForMode'), false, 'target integration catalog has no product-mode filter')
  assert.equal(targetCatalogSource.includes('@/modules/workspaces'), false, 'target integration catalog has no Workspaces dependency')
  assert.equal(targetCatalogSource.includes('supportedModes'), false, 'target integration catalog does not publish supported-mode authority')
  assert.equal(targetCatalogSource.includes('mode?: ProductInteractionMode'), false, 'target integration catalog cannot accept a historical product mode')
  assert.ok(catalogBindingSource.includes('listConversationToolCatalog'), 'bootstrap delegates manifest policy to the neutral target catalog')
  assert.equal(catalogBindingSource.includes("mode: 'chat'"), false, 'dynamic conversation tool listing needs no mode discriminator')
  assert.equal(catalogBindingSource.includes('mode?: ProductInteractionMode'), false, 'dynamic conversation tool listing cannot accept a historical product mode')

  const staticManifests = [
    annotateManifestExecutionPolicy(readOnly),
    annotateManifestExecutionPolicy(workArtifact),
    annotateManifestExecutionPolicy(writeTool),
    annotateManifestExecutionPolicy(androidRead),
  ]
  assert.ok(staticManifests.length > 0, 'static manifests are available')
  for (const manifest of staticManifests) {
    assert.equal('supportedModes' in manifest, false, `${manifest.id} has no supported-mode authority`)
    assert.ok(manifest.riskLevel, `${manifest.id} declares risk level`)
    assert.equal(typeof manifest.requiresConfirmation, 'boolean', `${manifest.id} declares confirmation policy`)
    assert.ok(manifest.outputBoundary, `${manifest.id} declares output boundary`)
  }

  assert.ok(staticManifests.some((tool) => tool.permission === 'read-write'), 'Chat-owned catalogs retain state-changing tools for downstream permission admission')
  assert.ok(staticManifests.some((tool) => tool.source === 'work-artifact'), 'Chat-owned catalogs retain work-artifact tools')
  assert.ok(staticManifests.some((tool) => tool.source === 'android'), 'Chat-owned catalogs retain enabled Android tools')

  console.log('Chat capability tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
