const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function run() {
  const chatStoreSource = read('src/store/chatStore.ts')
  assert.ok(chatStoreSource.includes('error: string | null'), 'Chat state exposes one recoverable error value')
  assert.ok(chatStoreSource.includes('setError: (error: string | null) => void'), 'Chat state exposes one error setter')
  assert.equal(/modeErrors|setErrorForMode|getErrorForMode|type ModeErrors/.test(chatStoreSource), false, 'mode-scoped error storage stays deleted')
  assert.ok(
    /clearAll:\s*\(\)\s*=>\s*\{[\s\S]*error:\s*null/.test(chatStoreSource),
    'clearAll resets the Chat error',
  )
  assert.ok(
    /importData:\s*\(conversations:\s*Conversation\[\]\)\s*=>\s*\{[\s\S]*error:\s*null/.test(chatStoreSource),
    'importData resets the Chat error',
  )
  assert.ok(chatStoreSource.includes("get().setError(st('chat.providerMissingDescription'"), 'missing-provider failures use the visible Chat error channel')
  assert.ok(chatStoreSource.includes("get().setError(st('chat.modelSwitchBlockedMessage'"), 'blocked-model failures use the visible Chat error channel')

  const legacyChatRunnerPath = path.join(root, 'src/services/chatRunner.ts')
  const assistantProjectionSource = read('src/modules/conversations/application/conversationAssistantMessageProjection.ts')
  const assistantProjectionBootstrapSource = read('src/bootstrap/conversationAssistantMessageProjection.ts')
  const webContextRuntimePath = path.join(root, 'src/modules/assistant-runtime/application/assistantConversationWebContextRuntime.ts')
  const webContextBootstrapPath = path.join(root, 'src/bootstrap/conversationWebContextRuntime.ts')
  const contextAcquisitionSource = read('src/modules/assistant-runtime/application/assistantConversationContextAcquisitionRuntime.ts')
  const conversationControlSource = read('src/presentation/features/conversations/conversationControlController.ts')
  const conversationControlCommandSource = read('src/presentation/features/conversations/conversationControlCommand.ts')
  const conversationMessageSource = read('src/presentation/features/conversations/conversationMessageController.ts')
  const conversationReplyDispatchSource = read('src/presentation/features/conversations/conversationReplyDispatchController.ts')
  const plainProjectionSource = read('src/presentation/features/conversations/plainChatProjection.ts')
  const plainControllerSource = read('src/presentation/features/conversations/plainChatController.ts')

  assert.equal(/\bproductMode\b/.test(conversationMessageSource), false, 'new user turns no longer carry retired product-mode state')
  assert.ok(conversationMessageSource.includes('dependencies.store.setError(null)'), 'message entry clears the single Chat error before dispatch')
  assert.equal(fs.existsSync(legacyChatRunnerPath), false, 'the replaced legacy message and reply-start facade stays deleted')

  assert.equal(fs.existsSync(webContextRuntimePath), false, 'the fixed pre-search application runtime stays deleted')
  assert.equal(fs.existsSync(webContextBootstrapPath), false, 'the fixed pre-search bootstrap binding stays deleted')
  assert.equal(/resolveWebContext|productMode/.test(contextAcquisitionSource), false, 'context acquisition cannot restore hidden web I/O or historical mode authority')

  assert.equal((conversationControlSource.match(/startAssistantReplyAfterHistoryProjection\(conversationId\)/g) ?? []).length, 2, 'retry and regenerate both start through the mode-free ordinary reply seam')
  assert.equal(/startAssistantReplyAfterHistoryProjection\(\s*conversationId\s*,/.test(conversationControlSource), false, 'retry and regenerate cannot restore a mode-bearing reply-start argument')
  assert.equal((conversationControlSource.match(/reportReplyStartFailure\((?:'retry'|'regenerate'), error\)/g) ?? []).length, 2, 'retry and regenerate report through one error callback')
  assert.ok(conversationControlCommandSource.includes('setError(error instanceof Error ? error.message : st(fallbackKey))'), 'retry and regenerate failures write the single Chat error')
  assert.equal(conversationControlSource.includes('previousUser.productMode ??'), false, 'historical user mode cannot select retry or regenerate execution')
  assert.ok(conversationReplyDispatchSource.includes('reportError(message: string): void'), 'ordinary and structured startup share one mode-free error contract')

  assert.ok(assistantProjectionSource.includes('error: string'), 'terminal projection emits one Chat error value')
  assert.equal(/modeError|reportModeError|ProductInteractionMode/.test(assistantProjectionSource), false, 'terminal reply projection has no mode-scoped error contract')
  assert.ok(
    /reportError\(error\)\s*\{[\s\S]*?setError\(error\)/.test(assistantProjectionBootstrapSource),
    'bootstrap applies the terminal projection to the single Chat error channel',
  )
  assert.ok(plainProjectionSource.includes('useChatStore.getState().setError(message)'), 'plain-Chat failure projection writes the single Chat error')
  assert.equal(plainControllerSource.includes('resolvePlainChatProjectionErrorMode'), false, 'the redundant fixed-mode resolver stays deleted')

  const chatStatusLayerSource = read('src/components/chat/ChatActiveStatusLayer.tsx')
  const programErrorBannerSource = read('src/components/chat/ProgramErrorBanner.tsx')
  assert.ok(chatStatusLayerSource.includes('state.error'), 'active status presentation reads the single Chat error')
  assert.match(chatStatusLayerSource, /function isConversationErrorProjected\([\s\S]*?message\.status !== 'error' && message\.status !== 'cancelled'[\s\S]*?value\?\.trim\(\) === normalizedError/, 'session failures and cancellations already projected into the message list do not render a duplicate warning')
  assert.ok(chatStatusLayerSource.includes('useState<string | null>(incomingProgramError)') && chatStatusLayerSource.includes('if (incomingProgramError) setProgramError(incomingProgramError)'), 'program errors stay latched until explicit dismissal')
  assert.ok(chatStatusLayerSource.includes('onDismiss={dismissProgramError}') && chatStatusLayerSource.includes('setProgramError(null)'), 'the program warning exposes an explicit manual close path')
  assert.ok(chatStatusLayerSource.includes('topOffset={providerHealthTopOffset}'), 'the program warning uses the measured floating-notice offset without double-counting safe-area insets')
  assert.ok(chatStatusLayerSource.includes('chat.programErrorTitle'), 'the program warning has application-owned localized copy')
  assert.ok(programErrorBannerSource.includes('chat.programErrorDismissAccessibilityLabel'), 'the program warning dismiss action has application-owned accessibility copy')
  assert.equal(fs.existsSync(path.join(root, 'src/components/chat/ModeErrorBanner.tsx')), false, 'the mode-named error banner stays deleted')

  for (const locale of ['en.json', 'ja.json', 'zh-CN.json']) {
    const source = read(`src/i18n/resources/${locale}`)
    assert.ok(source.includes('programErrorTitle'), `${locale} exposes the program error title`)
    assert.ok(source.includes('programErrorDismissAccessibilityLabel'), `${locale} exposes the program error dismiss label`)
    assert.equal(/conversationErrorTitle|conversationErrorDismissAccessibilityLabel/.test(source), false, `${locale} removes the retired conversation warning copy`)
    assert.equal(/modeErrorTitle|modeErrorDismissAccessibilityLabel/.test(source), false, `${locale} does not restore mode-scoped error copy`)
  }

  console.log('Chat and program error contract tests passed')
}

if (require.main === module) run()

module.exports = { run }
