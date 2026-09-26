// Render production message/Markdown/theme components with React Native Web.
// Only native services, stores and motion are replaced; Chromium owns layout.
// Uses Playwright's installed Chromium, or PLAYWRIGHT_CHANNEL=chrome/msedge.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { transformTypeScriptModule } = require('./node-ts-support')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const web = require('react-native-web')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const originalLoad = Module._load
const originalResolve = Module._resolveFilename
let width = 320
let theme
const empty = () => null
const passthrough = ({ children }) => children
const gesture = new Proxy({}, { get: () => () => gesture })
const stubs = {
  'react-native': { ...web, useWindowDimensions: () => ({ width, height: 800, scale: 1, fontScale: 1 }) },
  'react-native-reanimated': { Easing: { linear: x => x, out: fn => fn, inOut: fn => fn, quad: x => x * x }, runOnJS: fn => fn },
  'react-native-gesture-handler': { Gesture: gesture, GestureDetector: passthrough },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
  'moti': { MotiView: web.View },
  'expo-haptics': {},
  'expo-clipboard': {},
  'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { language: 'zh-CN' } }) },
  '@/i18n/service': { st: key => key },
  '@/hooks/useAppTheme': { useAppTheme: () => theme },
  '@/hooks/useMotionPreference': { useMotionPreference: () => 'none' },
  '@/store/settingsStore': { useSettingsStore: selector => selector({ settings: { hapticsEnabled: false } }) },
  '@/store/chatStreamingStore': { useChatStreamingStore: () => undefined, mergeMessageWithStreamingTraceSnapshot: message => message },
  '@/components/ui/AppIcon': { AppIcon: empty, appIconStroke: {} },
  '@/components/ui/ProviderBrandIcon': { ProviderBrandIcon: empty },
  '@/components/ui/isle': { IslePressable: web.Pressable, ISLE_MIN_TOUCH_TARGET: 44 },
  '@/components/ui/RenderGuard': { RenderGuard: passthrough },
  '@/modules/conversations': {},
  '@/presentation/features/conversations/workflowMessageActionSelectors': {
    getWorkflowPendingActionFromMessage: empty, getWorkflowEvidenceRepairActionFromMessage: empty,
    getWorkflowRecoveryActionFromMessage: empty, getWorkflowContinuationActionFromMessage: empty,
  },
  '@/presentation/features/conversations/workflowSkillSuggestionSelector': { getWorkflowSkillSuggestionFromMessage: empty },
  './MessageSources': { MessageSources: empty },
  './GlassSurface': { GlassSurface: passthrough },
  // The separate RN-library family is outside this four-family layout matrix.
  'animal-island-ui-rn': { Card: web.View },
}

Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, ...rest)
}
Module._load = function (request, ...rest) {
  return Object.hasOwn(stubs, request) ? stubs[request] : originalLoad.call(this, request, ...rest)
}
const compile = (module, filename) => module._compile(transformTypeScriptModule(fs.readFileSync(filename, 'utf8'), filename.endsWith('.js') ? `${filename}.tsx` : filename), filename)
require.extensions['.ts'] = compile
require.extensions['.tsx'] = compile
const originalJs = require.extensions['.js']
require.extensions['.js'] = (module, filename) => /react-native-markdown-display[\\/]src/.test(filename)
  ? compile(module, filename) : originalJs(module, filename)

async function main() {
  stubs['@/modules/conversations'] = {
    ...require('../src/modules/conversations/application/responseLifecycle.ts'),
    ...require('../src/modules/conversations/application/lifecycleActivityTimeline.ts'),
  }
  const { getColors } = require('../src/theme/colors.ts')
  const { MessageBubble } = require('../src/components/chat/MessageBubble.tsx')
  const cases = ['好的', '你好', '中文测试', 'OK', '继续 please', '这是一段需要正常换行的中文消息。'.repeat(12)]
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {})
  let count = 0
  try {
    const page = await browser.newPage()
    for (width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const family of ['minimal', 'monet', 'material', 'liquid-glass']) {
        theme = { colors: getColors('light', family), canonicalThemeId: family, isLiquidGlass: family === 'liquid-glass' }
        web.AppRegistry.registerComponent('MessageLayoutTest', () => () => React.createElement(web.View, { style: { width, padding: 12 } },
          cases.map((content, index) => React.createElement(web.View, { key: index, testID: `case-${index}` },
            React.createElement(MessageBubble, { conversationId: 'layout-test', index, motion: 'none', viewportHeight: 1000,
              message: { id: String(index), content, role: 'user', status: 'done', timestamp: 1 } }))),
          React.createElement(web.View, { testID: 'tool-failure' }, React.createElement(MessageBubble, {
            conversationId: 'layout-test', index: 10, motion: 'none', viewportHeight: 1000,
            message: { id: 'tool-failure', role: 'assistant', content: 'An answer without search results.', status: 'done', timestamp: 1,
              responseLifecycle: { stage: 'completed', startedAt: 1, stageStartedAt: 2, completedAt: 3, history: [] },
              retrievalTrace: [{ id: 'search-1', type: 'search', title: 'Search', status: 'error', content: 'Search service unavailable' }] },
          })),
        ))
        const { element, getStyleElement } = web.AppRegistry.getApplication('MessageLayoutTest')
        // Rendering registers Markdown's dynamic styles before CSS is collected.
        const markup = renderToStaticMarkup(element)
        await page.setContent(`<!doctype html><meta charset="utf-8">${renderToStaticMarkup(getStyleElement())}<body style="margin:0">${markup}</body>`)
        const measurements = await page.evaluate(values => values.map((content, index) => {
          const row = document.querySelector(`[data-testid="case-${index}"]`)
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
          let node
          while ((node = walker.nextNode()) && node.textContent !== content) {}
          if (!node) throw new Error(`Message text missing: ${index}`)
          const range = document.createRange()
          range.selectNodeContents(node)
          const rects = [...range.getClientRects()]
          const bubble = row.querySelector('[data-testid^="chat-message-surface-"]').getBoundingClientRect()
          return { lines: new Set(rects.map(rect => Math.round(rect.top))).size,
            contained: rects.every(rect => rect.left >= bubble.left - 1 && rect.right <= bubble.right + 1),
            inViewport: bubble.left >= 0 && bubble.right <= innerWidth,
            rightAligned: bubble.left > 12, width: bubble.width }
        }), cases)
        measurements.forEach((measurement, index) => {
          const label = `${family}/${width}/${index}`
          assert.equal(measurement.contained, true, `${label}: text stays inside its bubble`)
          assert.equal(measurement.inViewport, true, `${label}: no horizontal overflow`)
          assert.equal(measurement.rightAligned, true, `${label}: user messages stay on the right`)
          if (index < cases.length - 1) {
            assert.equal(measurement.lines, 1, `${label}: short text must not wrap`)
            assert.ok(measurement.width < 240, `${label}: short bubbles still hug content`)
          } else assert.ok(measurement.lines > 1, `${label}: long CJK text wraps`)
          count++
        })
        assert.equal(await page.getByTestId('tool-failure').getByRole('button', {
          name: 'messageBubble.activity.search.idle · messageBubble.activity.state.error', exact: true,
        }).count(), 1, `${family}/${width}: a completed reply must retain a failed-search activity with its own disclosure`)
        const activityBounds = await page.getByTestId('message-activity-row-trace:search-1').boundingBox()
        assert.ok(activityBounds && activityBounds.x >= 0 && activityBounds.x + activityBounds.width <= width,
          `${family}/${width}: activity rows stay within the viewport`)
      }
    }
    console.log(`PASS ${count} rendered message layouts and 12 completed-reply search-failure disclosures (Chromium; native layout not verified)`)
  } finally { await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
