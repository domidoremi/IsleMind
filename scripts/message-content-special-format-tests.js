const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  containsDisplayFormulaBlock,
  hasComplexDisplayFormulaStructure,
  hasUnambiguousPlainFormulaStructure,
  looksLikeBareSnakeCaseIdentifier,
  looksLikeUserAgentText,
  normalizeUserAgentText,
  shouldRenderFencedUserAgentAsText,
} = require('../src/components/chat/messageContentSpecialFormatPolicy.ts')

for (const value of ['say_ok', 'tool_call', 'search_web', 'read_file', 'edit_media', 'x_1']) {
  assert.equal(looksLikeBareSnakeCaseIdentifier(value), true, `${value} is a plain identifier token`)
  assert.equal(hasUnambiguousPlainFormulaStructure(value), false, `${value} cannot be promoted to a formula block without explicit math delimiters`)
}

for (const value of ['x=6', 'E = mc^2', 'x^2 + y^2 = z^2', 'a/b', 'x -> y', String.raw`\frac{a}{b}`]) {
  assert.equal(hasUnambiguousPlainFormulaStructure(value), true, `${value} has unambiguous mathematical structure`)
}

for (const value of ['OK', 'hello world', 'v1.2.3', 'https://example.com']) {
  assert.equal(hasUnambiguousPlainFormulaStructure(value), false, `${value} stays ordinary text`)
}

for (const value of ['x=6', 'E=mc^2', 'a/b', 'x -> y']) {
  assert.equal(hasComplexDisplayFormulaStructure(value), false, `${value} stays in the normal message flow`)
  assert.equal(containsDisplayFormulaBlock(value), false, `${value} does not widen or center the message bubble`)
}

for (const value of [String.raw`\sqrt{x}=3`, String.raw`\int_0^1 x^2 dx`, '√(x^2 + 1)', '∫_0^1 x² dx', 'x^2 + y^2 = z^2']) {
  assert.equal(hasComplexDisplayFormulaStructure(value), true, `${value} uses display-formula typography`)
  assert.equal(containsDisplayFormulaBlock(value), true, `${value} centers within the chat content region`)
}

assert.equal(containsDisplayFormulaBlock('$$x=6$$'), true, 'explicit display delimiters opt a simple equation into display layout')
assert.equal(containsDisplayFormulaBlock('```math\nx=6\n```'), true, 'an explicit math fence opts into display layout')
const naturalLanguageFormulaLine = `说明：${String.fromCharCode(92)}sqrt{x}=3`
assert.equal(containsDisplayFormulaBlock(naturalLanguageFormulaLine), false, 'natural-language lines are not widened by incidental formula syntax')

const indentedProviderIdentity = '    Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36\n    Grok/xAI'
assert.equal(looksLikeUserAgentText(indentedProviderIdentity), true, 'an indented browser UA plus provider identity is recognized as quoted client text')
assert.equal(
  normalizeUserAgentText(indentedProviderIdentity),
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36\nGrok/xAI',
  'quoted UA lines are de-indented before ordinary Markdown rendering',
)
assert.equal(looksLikeUserAgentText('IsleMind'), true, 'the historical bare IsleMind UA is recognized as client text')
for (const value of [
  'IsleMind/1.0.15',
  'codex_cli_rs/0.147.0 (Android; mobile) IsleMind/1.0.15',
  'Codex Desktop/0.147.0 (Android; mobile) IsleMind/1.0.15',
  'claude-code/2.1.229 (cli; IsleMind/1.0.15)',
  'Grok/xAI (compatible; IsleMind/1.0.15)',
]) {
  assert.equal(looksLikeUserAgentText(value), true, `${value} is recognized from generic client-UA syntax`)
}
for (const value of ['const value = 1', 'src/components/chat/MessageContent.tsx', 'npm/package', 'hello world']) {
  assert.equal(looksLikeUserAgentText(value), false, `${value} is not demoted from code by client-UA detection`)
}
assert.equal(shouldRenderFencedUserAgentAsText(undefined, indentedProviderIdentity), true, 'an unlabelled UA fence renders as ordinary text')
assert.equal(shouldRenderFencedUserAgentAsText('text', indentedProviderIdentity), false, 'an explicitly labelled fence retains code formatting')
assert.equal(shouldRenderFencedUserAgentAsText('bash', 'Mozilla/5.0'), false, 'an explicit code language is never demoted by UA detection')

const messageContentSource = fs.readFileSync(path.join(__dirname, '../src/components/chat/MessageContent.tsx'), 'utf8')
const formulaBlockStart = messageContentSource.indexOf('function FormulaBlockCard')
const formulaBlockEnd = messageContentSource.indexOf('function TableBlockCard', formulaBlockStart)
assert.ok(formulaBlockStart >= 0 && formulaBlockEnd > formulaBlockStart, 'formula presentation source is available for visual contract checks')
const formulaBlockSource = messageContentSource.slice(formulaBlockStart, formulaBlockEnd)

assert.match(formulaBlockSource, /fontSize: formulaFontSize/, 'formula typography scales to the expression density')
assert.match(formulaBlockSource, /textAlign: 'center'/, 'standalone formulas are centered')
assert.doesNotMatch(formulaBlockSource, /<RichCard|<CardHeader|name="sigma"|backgroundColor:|borderWidth:|borderRadius:/, 'formula presentation stays free of cards, labels, icons, and nested surfaces')

const messageBubbleSource = fs.readFileSync(path.join(__dirname, '../src/components/chat/MessageBubble.tsx'), 'utf8')
assert.match(messageBubbleSource, /const displayFormulaLayout = useMemo\(/, 'message bubbles derive complex display-formula layout explicitly')
assert.match(messageBubbleSource, /alignSelf: displayFormulaLayout \? 'center'/, 'complex formula bubbles align with the chat region center')
assert.match(messageBubbleSource, /const bubbleUsesAvailableWidth = displayFormulaLayout \|\|/, 'complex formula bubbles use the available chat width')

console.log('message content special-format policy tests passed')
