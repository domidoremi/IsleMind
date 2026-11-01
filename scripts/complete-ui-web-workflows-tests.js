const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const { settle } = require('./collect-complete-ui-web-evidence')
const worklist = require('./fixtures/worklists/complete-ui-experience-worklist.json')
const zh = require('../src/i18n/resources/zh-CN.json')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const baseUrl = option('--base-url', 'http://localhost:8081').replace(/\/$/, '')
const output = path.resolve(root, option('--output', 'test-evidence/qa/complete-ui-web-workflows.json'))

async function main() {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseUrl) || !output.startsWith(root + path.sep)) throw new Error('Use a local server and workspace evidence path')
  const browser = await chromium.launch({ executablePath: option('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true })
  const checks = []
  const errors = []
  let failure
  let page
  let diagnostic
  let stage = 'appearance preview'
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' })
    await context.route('**/*', request => request.request().url().startsWith(baseUrl + '/') || /^(data|blob):/.test(request.request().url()) ? request.continue() : request.abort())
    await context.addInitScript(() => {
      if (!localStorage.getItem('islemind-complete-ui-workflow')) {
        localStorage.setItem('@islemind/settings', JSON.stringify({ themeId: 'minimal', theme: 'light', language: 'zh-CN', autoCheckApkUpdate: false, backgroundMotion: 'static' }))
        localStorage.setItem('islemind-complete-ui-workflow', '1')
      }
      // Clipboard outcomes are controlled in this browser only. Never write the OS clipboard.
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async text => {
          globalThis.__uiCopiedText = text
          globalThis.__uiCopyCalls = (globalThis.__uiCopyCalls || 0) + 1
          if (globalThis.__uiCopyImmediate) return
          await new Promise((resolve, reject) => { globalThis.__uiFinishCopy = resolve; globalThis.__uiRejectCopy = reject })
        },
      } })
      // Expo can fall back to execCommand after a denied asynchronous write.
      const execCommand = document.execCommand.bind(document)
      document.execCommand = (command, ...parameters) => {
        if (/^(copy|cut|paste)$/i.test(command)) {
          globalThis.__uiLegacyClipboardCalls = (globalThis.__uiLegacyClipboardCalls || 0) + 1
          return false
        }
        return execCommand(command, ...parameters)
      }
    })
    page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message.slice(0, 250)))
    await page.goto(baseUrl + '/settings/system/appearance', { waitUntil: 'domcontentloaded' })
    await settle(page)
    await page.getByTestId('settings-theme-family-monet').click()
    await page.waitForFunction(() => document.documentElement.dataset.themeId === 'monet' && JSON.parse(localStorage.getItem('@islemind/settings')).themeId === 'monet')
    checks.push('family selection applies and persists without a second button')

    const originalAccent = await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).themeAccent ?? null)
    await page.getByTestId('settings-theme-accent-teal').click()
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).themeAccent ?? null), originalAccent)
    checks.push('accent selection remains a local preview')
    await page.getByTestId('settings-theme-family-minimal').click()
    await page.waitForFunction(() => document.documentElement.dataset.themeId === 'minimal' && JSON.parse(localStorage.getItem('@islemind/settings')).themeId === 'minimal')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).themeAccent ?? null), originalAccent)
    await page.getByTestId('settings-appearance-apply').click()
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('@islemind/settings')).themeAccent === '#0F766E')
    checks.push('immediate family changes retain the pending accent until explicit Apply')
    await page.getByTestId('settings-theme-accent-default').click()
    await page.getByTestId('settings-appearance-apply').click()
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem('@islemind/settings')).themeAccent)

    await page.getByTestId('settings-theme-mode-system').click()
    const rawDraft = '#unfinished'
    await page.getByTestId('settings-theme-accent-input').fill(rawDraft)
    await page.evaluate(() => { globalThis.__uiAccentNode = document.querySelector('[data-testid="settings-theme-accent-input"]') })
    for (const family of worklist.families) {
      stage = `apply ${family}`
      await page.getByTestId(`settings-theme-family-${family}`).click()
      await page.waitForFunction(family => document.documentElement.dataset.themeId === family && JSON.parse(localStorage.getItem('@islemind/settings')).theme === 'system', family)
      await page.waitForFunction(label => document.querySelector('[data-testid="settings-appearance-status-glyph"]')?.getAttribute('aria-label') === label, zh.settings.appearanceApplied)
      assert.equal(await page.getByTestId('settings-theme-accent-input').inputValue(), rawDraft)
      assert.equal(await page.evaluate(() => globalThis.__uiAccentNode === document.querySelector('[data-testid="settings-theme-accent-input"]')), true, 'native input identity survives family changes')
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).themeId), family)
      checks.push(`${family}: applies durably without replacing the raw color input`)
      await page.getByTestId('settings-theme-accent-input').focus()
      for (const scheme of ['dark', 'light']) {
        stage = `${family}: system ${scheme}`
        await page.emulateMedia({ colorScheme: scheme })
        await page.waitForFunction(scheme => document.documentElement.dataset.themeMode === scheme, scheme)
        assert.equal(await page.evaluate(() => document.activeElement === globalThis.__uiAccentNode), true)
        assert.equal(await page.getByTestId('settings-theme-accent-input').inputValue(), rawDraft)
        checks.push(`${family}/${scheme}: follows system and retains focus/draft`)
      }
    }
    await page.getByTestId('settings-theme-accent-input').fill('')
    assert.equal(await page.getByTestId('app-toast-motion').count(), 0)

    stage = 'usage export denial and retry'
    await page.goto(baseUrl + '/settings/usage', { waitUntil: 'domcontentloaded' })
    await settle(page)
    await page.getByRole('button', { name: 'JSON', exact: true }).click()
    await page.waitForFunction(() => typeof globalThis.__uiRejectCopy === 'function')
    assert.equal(await page.getByRole('button', { name: zh.usage.exporting, exact: true }).isDisabled(), true)
    await page.evaluate(() => globalThis.__uiRejectCopy(new Error('QA usage clipboard denied')))
    await page.waitForFunction(label => document.querySelector('[data-testid="page-action-feedback"]')?.textContent.includes(label), zh.usage.exportFailed)
    assert.equal(await page.getByTestId('app-toast-motion').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'JSON', exact: true }).isEnabled(), true)
    checks.push('usage export denial remains page-local and releases its controls')
    await page.getByTestId('page-action-feedback').getByRole('button', { name: zh.common.close, exact: true }).click()
    await page.evaluate(() => { globalThis.__uiCopyImmediate = true })
    await page.getByRole('button', { name: 'JSON', exact: true }).click()
    await page.waitForFunction(label => document.querySelector('[data-testid="page-feedback-indicator-announcement"]')?.textContent.includes(label), zh.usage.exportCopied)
    assert.equal(await page.getByTestId('page-action-feedback').count(), 0)
    assert.equal(await page.evaluate(() => globalThis.__uiCopyCalls), 2)
    assert.equal(await page.evaluate(() => globalThis.__uiLegacyClipboardCalls), 1)
    assert.equal(await page.evaluate(() => typeof globalThis.__uiCopiedText === 'string' && globalThis.__uiCopiedText.length > 0), true)
    checks.push('usage export retry confirms a real result rather than an exported-file claim')

    stage = 'source original launch denial'
    const sourceUrl = baseUrl + '/source?url=' + encodeURIComponent('https://example.invalid/qa-ui-original')
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' })
    await settle(page)
    await page.evaluate(() => { window.open = () => { throw new Error('QA popup denied') } })
    await page.getByRole('button', { name: zh.source.openOriginal, exact: true }).click()
    await page.waitForFunction(label => document.querySelector('[data-testid="page-action-feedback"]')?.textContent.includes(label), zh.source.cannotOpen)
    assert.equal(page.url(), sourceUrl)
    assert.equal(await page.getByTestId('app-toast-motion').count(), 0)
    checks.push('source launch denial stays on its route with local feedback and no external popup')

    stage = 'document save and reload'
    await page.goto(baseUrl + '/documents/edit', { waitUntil: 'domcontentloaded' })
    await settle(page)
    const title = 'QA complete UI document'
    const body = 'A browser-owned fixture. No model or external service is contacted.'
    await page.getByTestId('document-title').fill(title)
    await page.getByTestId('document-body').fill(body)
    await page.getByRole('button', { name: zh.common.save, exact: true }).click()
    await page.waitForFunction(label => document.querySelector('[data-testid="document-save-status"]')?.textContent === label, zh.documents.saved)
    const documentUrl = page.url()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(page)
    assert.equal(page.url(), documentUrl)
    assert.equal(await page.getByTestId('document-title').inputValue(), title)
    assert.equal(await page.getByTestId('document-body').inputValue(), body)
    checks.push('document save survives an actual browser reload')

    const draft = body + '\nNot saved.'
    stage = 'pending copy through system changes'
    await page.getByTestId('document-body').fill(draft)
    await page.getByRole('button', { name: zh.documents.copyText, exact: true }).click()
    assert.equal(await page.getByRole('button', { name: zh.documents.copyText, exact: true }).isDisabled(), true)
    await page.getByTestId('document-body').focus()
    await page.evaluate(() => {
      globalThis.__uiBodyNode = document.querySelector('[data-testid="document-body"]')
      globalThis.__uiBodyNode.setSelectionRange(5, 12)
    })
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForFunction(scheme => document.documentElement.dataset.themeMode === scheme, scheme)
      assert.equal(await page.getByTestId('document-body').inputValue(), draft)
      assert.equal(await page.evaluate(() => document.activeElement === globalThis.__uiBodyNode && globalThis.__uiBodyNode.selectionStart === 5 && globalThis.__uiBodyNode.selectionEnd === 12), true)
    }
    stage = 'clipboard denial'
    await page.evaluate(() => globalThis.__uiRejectCopy(new Error('QA clipboard denied')))
    await page.waitForFunction(label => document.querySelector('[data-testid="document-copy-feedback"]')?.textContent.includes(label), zh.chat.clipboardUnavailable)
    assert.equal(await page.getByTestId('app-toast-motion').count(), 0)
    assert.equal(await page.getByTestId('document-body').inputValue(), draft)
    checks.push('clipboard failure stays inline and retains an unsaved document through system changes')
    stage = 'clipboard retry'
    await page.evaluate(() => { globalThis.__uiCopyImmediate = true })
    await page.getByRole('button', { name: zh.documents.copyText, exact: true }).click()
    await page.waitForFunction(label => document.querySelector('[data-testid="document-copy"]')?.getAttribute('aria-label')?.includes(label), zh.documents.copyNotice)
    assert.equal(await page.getByTestId('document-copy-feedback').count(), 0)
    assert.equal(await page.evaluate(() => globalThis.__uiCopiedText), draft)
    assert.equal(await page.evaluate(() => globalThis.__uiCopyCalls), 2)
    assert.equal(await page.evaluate(() => globalThis.__uiLegacyClipboardCalls), 1)
    assert.equal(await page.getByTestId('document-save-status').innerText(), zh.documents.unsaved)
    assert.equal(await page.getByTestId('app-toast-motion').count(), 0)
    checks.push('copy retry confirms its real outcome without saving the draft or showing a toast')
    assert.equal(errors.length, 0, JSON.stringify(errors))
    await context.close()
  } catch (error) {
    failure = error.message.slice(0, 1500)
    if (page) diagnostic = await page.evaluate(() => ({
      family: document.documentElement.dataset.themeId,
      mode: document.documentElement.dataset.themeMode,
      mediaDark: matchMedia('(prefers-color-scheme: dark)').matches,
      storedTheme: JSON.parse(localStorage.getItem('@islemind/settings'))?.theme,
      copyReceipt: document.querySelector('[data-testid="document-copy-feedback"]')?.textContent?.slice(0, 160),
      pageReceipt: document.querySelector('[data-testid="page-action-feedback"]')?.textContent?.slice(0, 160),
    })).catch(() => undefined)
  }
  finally { await browser.close() }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify({ schema: 'islemind.complete-ui-web-workflows.v1', capturedAt: new Date().toISOString(), checks, errors, failure, failureStage: failure ? stage : undefined, diagnostic, nativeAcceptance: false, isolatedBrowserData: true, osClipboardWritten: false, legacyClipboardBlocked: true }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, failure, failureStage: failure ? stage : undefined, diagnostic, errors: errors.length, nativeAcceptance: false }))
  if (failure) process.exitCode = 1
}
main().catch(error => { console.error(error.message.slice(0, 1000)); process.exitCode = 1 })
