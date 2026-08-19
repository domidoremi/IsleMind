const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const settingsModule = await import('../src/modules/settings/index.ts')
  const identityPresentation = await import('../src/components/chat/chatIdentityPresentation.ts')
  const messageActivityPresentation = await import('../src/components/chat/messageActivityPreview.ts')
  const fixture = createFixture(settingsModule)

  await testSnapshot(fixture)
  testAppearanceNormalization(settingsModule)
  testIdentityNormalization(settingsModule)
  testIdentityHydrationWhitelist()
  testIdentityPresentation(identityPresentation)
  testIdentityActivityPresentation(messageActivityPresentation)
  await testMutations(fixture)
  await testValidationAndCancellation(fixture)
  await testPortFailure(fixture, settingsModule)

  console.log('vNext settings action tests passed')
}

function testIdentityNormalization(settingsModule) {
  assert.equal(settingsModule.normalizeSettingsIdentityDisplayName('  My\n Assistant  '), 'My Assistant')
  assert.equal(settingsModule.normalizeSettingsIdentityDisplayName('e\u0301'), '\u00e9', 'display names normalize to NFC')
  assert.equal(settingsModule.normalizeSettingsIdentityDisplayName('   '), undefined)
  assert.equal(
    Array.from(settingsModule.normalizeSettingsIdentityDisplayName('x'.repeat(80))).length,
    settingsModule.SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH,
    'display names remain bounded',
  )

  const aliases = settingsModule.normalizeSettingsModelDisplayAliases([
    { providerId: 'provider-a', modelId: 'model-a', displayName: 'First' },
    { providerId: 'provider-a', modelId: 'model-a', displayName: 'Latest' },
    { providerId: 'provider-b', modelId: 'model-b', displayName: '  Research\nModel ' },
    { providerId: '', modelId: 'missing-provider', displayName: 'Ignored' },
    { providerId: 'provider-c', modelId: 'model-c', displayName: '   ' },
    { providerId: 'provider-d', modelId: 'bad\nmodel', displayName: 'Ignored' },
  ])
  assert.deepEqual(aliases, [
    { providerId: 'provider-a', modelId: 'model-a', displayName: 'Latest' },
    { providerId: 'provider-b', modelId: 'model-b', displayName: 'Research Model' },
  ])

  const added = settingsModule.upsertSettingsModelDisplayAlias(aliases, {
    providerId: 'provider-c',
    modelId: 'model-c',
    displayName: 'Writer',
  })
  assert.equal(settingsModule.getSettingsModelDisplayAlias(added, 'provider-c', 'model-c'), 'Writer')
  const removed = settingsModule.upsertSettingsModelDisplayAlias(added, {
    providerId: 'provider-c',
    modelId: 'model-c',
    displayName: '',
  })
  assert.equal(settingsModule.getSettingsModelDisplayAlias(removed, 'provider-c', 'model-c'), undefined)

  const raw = {
    theme: 'system',
    language: 'en',
    defaultProvider: null,
    fontSize: 16,
    hapticsEnabled: true,
    assistantDisplayName: '\n Ada  ',
    modelDisplayAliases: [{ providerId: 'provider-a', modelId: 'model-a', displayName: ' Code ' }],
  }
  const normalized = settingsModule.normalizeSettingsIdentityPreferences(raw)
  assert.notEqual(normalized, raw, 'malformed persisted identity receives a normalized copy')
  assert.equal(normalized.assistantDisplayName, 'Ada')
  assert.deepEqual(normalized.modelDisplayAliases, [{ providerId: 'provider-a', modelId: 'model-a', displayName: 'Code' }])
  assert.equal(raw.assistantDisplayName, '\n Ada  ', 'normalization does not mutate persisted input')
}

function testIdentityHydrationWhitelist() {
  const settingsStoreSource = fs.readFileSync(path.join(__dirname, '../src/store/settingsStore.ts'), 'utf8')
  const defaultSettingsSource = settingsStoreSource.match(/const defaultSettings: Settings = \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.ok(defaultSettingsSource.includes('assistantDisplayName: undefined'), 'hydration retains the global assistant display name')
  assert.ok(defaultSettingsSource.includes('modelDisplayAliases: undefined'), 'hydration retains provider/model display aliases')
  assert.ok(settingsStoreSource.includes('...Object.keys(defaultSettings)'), 'hydration derives its retained keys from the default settings contract')
}

function testIdentityPresentation(identityPresentation) {
  const provider = { id: 'provider-a', name: 'Provider A', type: 'openai', models: ['model-a'], enabled: true }
  const aliases = [{ providerId: 'provider-a', modelId: 'model-a', displayName: 'Researcher' }]
  assert.equal(identityPresentation.resolveChatAssistantDisplayName(undefined), undefined, 'Chat does not manufacture a default assistant name')
  assert.equal(identityPresentation.resolveChatIdentityTitle(undefined, 'Start chatting'), 'Start chatting', 'unnamed Chat keeps localized generic copy')
  assert.equal(identityPresentation.resolveChatIdentityTitle('Ada', 'Start chatting'), 'Ada')
  assert.equal(identityPresentation.resolveChatModelDisplayName(provider, 'model-a', aliases), 'Researcher')
  assert.equal(identityPresentation.resolveChatModelDisplayName(provider, 'model-b', aliases), 'Model B', 'unknown aliases keep the canonical display fallback')
}

function testIdentityActivityPresentation(messageActivityPresentation) {
  const t = (key, options = {}) => {
    if (key === 'messageBubble.namedThinking') return `${options.name} is thinking...`
    if (key === 'chat.statusPreparing') return 'Preparing'
    return options.defaultValue ?? key
  }
  const message = {
    id: 'assistant-pending',
    role: 'assistant',
    content: '',
    timestamp: 1,
    status: 'sending',
  }
  assert.equal(messageActivityPresentation.getMessageActivityLabel(message, t, 'Ada'), 'Ada is thinking...')
  const unnamedActivity = messageActivityPresentation.getMessageActivityLabel(message, t)
  assert.ok(unnamedActivity.length > 0 && unnamedActivity !== 'Ada is thinking...', 'unnamed activity retains its existing locale-owned fallback')
}

function testAppearanceNormalization(settingsModule) {
  assert.equal(settingsModule.normalizeSettingsThemeMode('light'), 'light')
  assert.equal(settingsModule.normalizeSettingsThemeMode('dark'), 'dark')
  assert.equal(settingsModule.normalizeSettingsThemeMode('system'), 'system')
  assert.equal(settingsModule.normalizeSettingsThemeMode('sepia'), undefined, 'unknown persisted modes fail closed')
  assert.equal(settingsModule.normalizeSettingsThemeFamily('minimal'), 'minimal')
  assert.equal(settingsModule.normalizeSettingsThemeFamily('monet'), 'monet')
  assert.equal(settingsModule.normalizeSettingsThemeFamily('material'), 'material')
  assert.equal(settingsModule.normalizeSettingsThemeFamily('liquid-glass'), 'liquid-glass')
  assert.equal(settingsModule.normalizeSettingsThemeFamily('glass'), 'liquid-glass')
  assert.equal(settingsModule.normalizeSettingsThemeFamily('cartoon'), 'monet')
  assert.equal(settingsModule.normalizeSettingsThemeFamily('island'), 'monet')
  assert.equal(settingsModule.normalizeSettingsThemeFamily('markdown'), 'material')
}

function createFixture(settingsModule) {
  const state = {
    theme: 'system',
    themeId: 'minimal',
    themeAccent: undefined,
    language: 'zh-CN',
    memoryEnabled: false,
    knowledgeEnabled: false,
    webSearchEnabled: true,
    skillsEnabled: true,
    mcpEnabled: true,
    commandPaletteEnabled: true,
    hapticsEnabled: true,
  }
  const calls = []
  const port = {
    getSnapshot() {
      return { ...state }
    },
    setTheme(theme) {
      calls.push(['theme', theme])
      state.theme = theme
    },
    setThemeFamily(themeFamily) {
      calls.push(['themeFamily', themeFamily])
      state.themeId = themeFamily
    },
    setThemeAccent(themeAccent) {
      calls.push(['themeAccent', themeAccent])
      state.themeAccent = themeAccent
    },
    setLanguage(language) {
      calls.push(['language', language])
      state.language = language
    },
    setFeatureFlag(flag, enabled) {
      calls.push(['feature', flag, enabled])
      state[flag] = enabled
    },
  }
  return {
    state,
    calls,
    port,
    useCase: settingsModule.createSettingsActionUseCase({ settings: port }),
  }
}

async function testSnapshot(fixture) {
  const result = await fixture.useCase.execute({ name: 'get_settings' })
  assert.equal(result.ok, true, 'the target use case reads a settings snapshot through its port')
  if (!result.ok) throw new Error(result.error.message)
  assert.deepEqual(result.value, { action: 'get_settings', snapshot: fixture.state })
}

async function testMutations(fixture) {
  const theme = await fixture.useCase.execute({ name: 'set_theme_mode', arguments: { theme: 'dark' } })
  assert.equal(theme.ok, true)
  if (!theme.ok) throw new Error(theme.error.message)
  assert.deepEqual(theme.value, { action: 'set_theme_mode', theme: 'dark' })

  const family = await fixture.useCase.execute({ name: 'set_theme_family', arguments: { family: 'island' } })
  assert.equal(family.ok, true)
  if (!family.ok) throw new Error(family.error.message)
  assert.deepEqual(family.value, { action: 'set_theme_family', themeFamily: 'monet' }, 'the target module migrates the island compatibility input to Monet')

  const legacyFamily = await fixture.useCase.execute({ name: 'set_theme_family', arguments: { family: 'glass' } })
  assert.equal(legacyFamily.ok, true)
  if (!legacyFamily.ok) throw new Error(legacyFamily.error.message)
  assert.deepEqual(legacyFamily.value, { action: 'set_theme_family', themeFamily: 'liquid-glass' }, 'the target module migrates legacy glass requests to Liquid Glass')

  const accent = await fixture.useCase.execute({ name: 'set_theme_accent', arguments: { color: '#4f6' } })
  assert.equal(accent.ok, true)
  if (!accent.ok) throw new Error(accent.error.message)
  assert.deepEqual(accent.value, { action: 'set_theme_accent', themeAccent: '#44FF66' })

  const resetAccent = await fixture.useCase.execute({ name: 'set_theme_accent', arguments: { color: 'default' } })
  assert.equal(resetAccent.ok, true)
  if (!resetAccent.ok) throw new Error(resetAccent.error.message)
  assert.deepEqual(resetAccent.value, { action: 'set_theme_accent', themeAccent: null })

  const language = await fixture.useCase.execute({ name: 'set_language', arguments: { locale: 'en' } })
  assert.equal(language.ok, true)
  if (!language.ok) throw new Error(language.error.message)
  assert.deepEqual(language.value, { action: 'set_language', language: 'en' })

  const feature = await fixture.useCase.execute({ name: 'set_feature_flag', arguments: { flag: 'web search', value: 'off' } })
  assert.equal(feature.ok, true)
  if (!feature.ok) throw new Error(feature.error.message)
  assert.deepEqual(feature.value, { action: 'set_feature_flag', flag: 'webSearchEnabled', enabled: false })
  assert.deepEqual(fixture.calls, [
    ['theme', 'dark'],
    ['themeFamily', 'monet'],
    ['themeFamily', 'liquid-glass'],
    ['themeAccent', '#44FF66'],
    ['themeAccent', undefined],
    ['language', 'en'],
    ['feature', 'webSearchEnabled', false],
  ], 'all current app-setting mutations cross the injected port')
}

async function testValidationAndCancellation(fixture) {
  const before = fixture.calls.length
  const invalidTheme = await fixture.useCase.execute({ name: 'set_theme_mode', arguments: { mode: 'blue' } })
  assert.equal(invalidTheme.ok, false)
  if (invalidTheme.ok) throw new Error('Expected invalid theme rejection.')
  assert.equal(invalidTheme.error.code, 'invalid_theme_mode')

  const invalidFeature = await fixture.useCase.execute({ name: 'set_feature_flag', arguments: { flag: 'unknown', enabled: true } })
  assert.equal(invalidFeature.ok, false)
  if (invalidFeature.ok) throw new Error('Expected invalid feature rejection.')
  assert.equal(invalidFeature.error.code, 'invalid_feature_flag')

  const invalidAccent = await fixture.useCase.execute({ name: 'set_theme_accent', arguments: { color: 'javascript:red' } })
  assert.equal(invalidAccent.ok, false)
  if (invalidAccent.ok) throw new Error('Expected invalid accent rejection.')
  assert.equal(invalidAccent.error.code, 'invalid_theme_accent')

  const controller = new AbortController()
  controller.abort()
  const cancelled = await fixture.useCase.execute(
    { name: 'set_language', arguments: { language: 'ja' } },
    { signal: controller.signal },
  )
  assert.equal(cancelled.ok, false)
  if (cancelled.ok) throw new Error('Expected cancelled action.')
  assert.equal(cancelled.error.code, 'cancelled')
  assert.equal(fixture.calls.length, before, 'rejected and cancelled actions do not mutate settings')

  const rejected = await fixture.useCase.execute({ name: 'delete_everything' })
  assert.equal(rejected.ok, false)
  if (rejected.ok) throw new Error('Expected unsupported action rejection.')
  assert.equal(rejected.error.code, 'rejected')
}

async function testPortFailure(fixture, settingsModule) {
  const failingUseCase = settingsModule.createSettingsActionUseCase({
    settings: {
      ...fixture.port,
      setTheme() {
        throw new Error('storage unavailable')
      },
    },
  })
  const result = await failingUseCase.execute({ name: 'set_theme_mode', arguments: { mode: 'light' } })
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('Expected port failure.')
  assert.equal(result.error.code, 'operation_failed', 'adapter exceptions do not cross the target module boundary')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
