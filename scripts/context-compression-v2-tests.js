const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')
const { packChatMessages } = require('../src/bootstrap/contextPacking.ts')
const { createContextPackingPolicy } = require('../src/modules/assistant-runtime/index.ts')
const { estimateMessageTokens, estimateTextTokens } = require('../src/services/tokenUsage.ts')

function run() {
  const semanticMessages = [
    { role: 'user', content: `用户约束: 必须保留本地压缩回退。${'constraint detail '.repeat(60)}` },
    { role: 'assistant', content: `已确认决策: 采用 structured-v2。${'decision detail '.repeat(60)}` },
    { role: 'user', content: `失败与风险: 验证可能 timeout。${'risk detail '.repeat(60)}` },
    { role: 'assistant', content: `待办与下一步: 运行测试并检查 src/services/contextPacker.ts。${'action detail '.repeat(60)}` },
    { role: 'user', content: `重要引用: docs/architecture/vnext-migration-status.md scripts/context-compression-v2-tests.js。${'reference detail '.repeat(50)}` },
    ...Array.from({ length: 9 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `recent retained message ${index} ${'recent detail '.repeat(70)}`,
    })),
  ]
  const localPacked = packChatMessages({
    messages: semanticMessages,
    contextPrompt: 'retrieved context',
    modelContextWindow: 2600,
    maxOutputTokens: 256,
  })
  const remoteProbe = packChatMessages({
    messages: semanticMessages,
    contextPrompt: 'retrieved context',
    modelContextWindow: 2600,
    maxOutputTokens: 256,
    localCompression: false,
  })

  assert.equal(localPacked.compressionMetadata.schemaVersion, 2, 'local compression exposes metadata schema v2')
  assert.equal(localPacked.compressionMetadata.strategy, 'structured-v2', 'local compression uses the structured-v2 strategy')
  for (const heading of ['用户约束', '已确认决策', '失败与风险', '待办与下一步', '重要引用']) {
    assert.ok(localPacked.contextPrompt.includes(heading), `budget compaction preserves the ${heading} section`)
  }
  assert.ok(localPacked.contextPrompt.includes('src/services/contextPacker.ts'), 'budget compaction preserves a stable source reference')
  assert.ok(localPacked.compressionMetadata.summarySectionCount >= 5, 'local compression reports semantic section coverage')
  assert.ok(localPacked.compressionMetadata.summaryTokens <= localPacked.compressionMetadata.summaryTokenBudget, 'local compression stays inside its summary budget')
  assert.equal(remoteProbe.trimmedCount, 0, 'remote compact probe keeps untrimmed history')
  assert.equal(remoteProbe.compressionTriggered, false, 'remote compact probe bypasses local compression')

  const reserveCalls = []
  const targetPolicy = createContextPackingPolicy({
    estimateMessageTokens,
    estimateTextTokens,
    estimateReasoningReserve(input) {
      reserveCalls.push(input)
      return 0
    },
  })
  const targetPacked = targetPolicy.packChatMessages({
    messages: semanticMessages,
    contextPrompt: 'retrieved context',
    modelContextWindow: 2600,
    maxOutputTokens: 256,
  })
  assert.deepEqual(targetPacked, localPacked, 'bootstrap preserves exact target packing output')
  assert.deepEqual(reserveCalls, [{
    reasoningEffort: undefined,
    provider: undefined,
    providerType: undefined,
    model: undefined,
  }], 'target packing delegates one exact reasoning-reserve input')

  const frozenMessages = Object.freeze([
    Object.freeze({ role: 'user', content: 'fallback must not win', responseText: '' }),
    Object.freeze({ role: 'assistant', content: 'ignored error', status: 'error' }),
    Object.freeze({ role: 'assistant', content: 'ignored cancellation', status: 'cancelled' }),
    Object.freeze({
      role: 'user',
      content: '',
      attachments: Object.freeze([Object.freeze({
        id: 'attachment-1',
        type: 'text',
        uri: 'file:///fixture.txt',
        name: 'fixture.txt',
        mimeType: 'text/plain',
        size: 128,
      })]),
    }),
  ])
  const frozenSnapshot = JSON.stringify(frozenMessages)
  const filtered = targetPolicy.packChatMessages({
    messages: frozenMessages,
    modelContextWindow: 4096,
    maxOutputTokens: 128,
  })
  assert.deepEqual(filtered.messages, [{ role: 'user', content: '' }], 'packing keeps attachment-only input while responseText precedence and terminal filtering stay exact')
  assert.equal(JSON.stringify(frozenMessages), frozenSnapshot, 'packing does not mutate frozen caller messages or attachments')
  assert.deepEqual(
    targetPolicy.packChatMessages({ messages: semanticMessages, contextPrompt: 'retrieved context', modelContextWindow: 2600, maxOutputTokens: 256 }),
    targetPacked,
    'repeated packing is deterministic',
  )

  const accountingPolicy = createContextPackingPolicy({
    estimateTextTokens: (text) => text.length,
    estimateMessageTokens: (messages) => messages.reduce((total, message) => total + message.content.length, 0),
    estimateReasoningReserve: () => 0,
  })
  const accountingContext = 'c'.repeat(300)
  const accountingPacked = accountingPolicy.packChatMessages({
    messages: Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: 'm'.repeat(100),
    })),
    contextPrompt: accountingContext,
    systemPrompt: 's'.repeat(20),
    modelContextWindow: 1200,
    maxOutputTokens: 100,
  })
  const summaryPrompt = accountingPacked.contextPrompt.slice(accountingContext.length + 2)
  assert.ok(summaryPrompt.startsWith('历史摘要\n'), 'compressed context keeps a separately attributable history summary')
  assert.equal(
    accountingPacked.estimatedInputTokens,
    accountingPacked.messageTokens + summaryPrompt.length,
    'compressed input accounting charges the base context only through fixedTokens',
  )
  assert.ok(
    accountingPacked.fixedTokens + accountingPacked.estimatedInputTokens <= accountingPacked.modelBudgetTokens,
    'compressed input accounting stays inside the complete model budget',
  )

  const reservedPolicy = createContextPackingPolicy({
    estimateMessageTokens,
    estimateTextTokens,
    estimateReasoningReserve: () => 1024,
  })
  const reserved = reservedPolicy.packChatMessages({
    messages: [{ role: 'user', content: 'reasoning reserve probe' }],
    modelContextWindow: 4096,
    maxOutputTokens: 256,
  })
  assert.equal(reserved.reasoningReserveTokens, 1024, 'target packing uses the injected reasoning reserve exactly')
  assert.equal(reserved.reservedOutputTokens, 1280, 'target packing adds output and reasoning reserves exactly once')
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'contextPacker.ts')),
    false,
    'retired context-packer facade must stay deleted',
  )

  runArchitectureContractSmoke({
    label: 'Context compression v2',
    checkIds: ['context-pipeline-boundary'],
  })

  console.log('Context compression v2 tests passed')
}

if (require.main === module) run()

module.exports = { run }
