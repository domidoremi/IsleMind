const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const originalResolve = Module._resolveFilename
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith('@/')
    ? path.join(__dirname, '..', 'src', request.slice(2)) : request, parent, isMain, options)
}
require.extensions['.ts'] = (module, filename) => {
  module._compile(transformTypeScriptModule(fs.readFileSync(filename, 'utf8'), filename), filename)
}
const { fetchProviderWithTimeout, fetchProviderStreamWithTimeout } = require('../src/modules/providers/providerTransportUtils.ts')

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
})
const close = (server) => new Promise((resolve) => {
  server.close(resolve)
  server.closeAllConnections()
})

async function run() {
  let redirectedRequests = 0
  const target = http.createServer((_req, res) => {
    redirectedRequests += 1
    res.end('unexpected redirected request')
  })
  let targetUrl
  const origin = http.createServer((req, res) => {
    if (req.url === '/success') return res.end('ok')
    if (req.url === '/pending') return
    if (req.url === '/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: ready\n\n')
      return
    }
    res.writeHead(Number(req.url.slice(1)), { Location: targetUrl })
    res.end()
  })
  try {
    targetUrl = await listen(target)
    const originUrl = await listen(origin)
    for (const transport of [fetchProviderWithTimeout, fetchProviderStreamWithTimeout]) {
      for (const requestedRedirect of [undefined, 'follow', 'error', 'manual']) {
        await transport(async (_input, init) => {
          assert.equal(init.redirect, requestedRedirect === 'manual' ? 'manual' : 'error')
          return new Response('ok')
        }, originUrl, { redirect: requestedRedirect }, 1000)
      }
      for (const status of [301, 302, 303, 307, 308]) {
        // No real credentials or user data. Different loopback ports are different origins.
        const init = { method: 'POST', headers: { 'x-api-key': 'synthetic-test-key' }, body: 'synthetic prompt' }
        for (const redirect of [undefined, 'follow']) {
          await assert.rejects(transport(fetch, `${originUrl}/${status}`, { ...init, redirect }, 1000))
        }
        const manual = await transport(fetch, `${originUrl}/${status}`, { ...init, redirect: 'manual' }, 1000)
        assert.equal(manual.status, status, 'manual callers must receive the original redirect response')
        await manual.text()
      }
      assert.equal(redirectedRequests, 0, 'neither credentials nor request bodies may reach a redirected origin')
      const response = await transport(fetch, `${originUrl}/success`, undefined, 1000)
      assert.equal(await response.text(), 'ok')
      await assert.rejects(transport(fetch, `${originUrl}/pending`, undefined, 30), { name: 'AbortError' })

      const caller = new AbortController()
      const pending = transport(fetch, `${originUrl}/pending`, { signal: caller.signal }, 1000)
      caller.abort()
      await assert.rejects(pending, { name: 'AbortError' })

      let signalAfterHeaders
      const streamCaller = new AbortController()
      await transport(async (_input, init) => {
        signalAfterHeaders = init.signal
        return new Response('headers')
      }, originUrl, { signal: streamCaller.signal }, 10)
      await new Promise((resolve) => setTimeout(resolve, 30))
      assert.equal(signalAfterHeaders.aborted, false, 'header timeout must be cleared after headers')
      streamCaller.abort()
      assert.equal(signalAfterHeaders.aborted, true, 'caller cancellation remains connected after headers')

      const bodyCaller = new AbortController()
      const stream = await transport(fetch, `${originUrl}/stream`, { signal: bodyCaller.signal }, 1000)
      const reader = stream.body.getReader()
      await reader.read()
      bodyCaller.abort()
      await assert.rejects(reader.read(), { name: 'AbortError' })
      reader.releaseLock()
    }
    console.log('Provider transport security tests passed: redirects blocked; manual responses, success, deadlines and cancellation preserved')
  } finally {
    await Promise.all([close(origin), close(target)])
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
