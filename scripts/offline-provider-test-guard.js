const net = require('node:net')
const preload = `--require ${JSON.stringify(__filename)}`
if (!process.env.NODE_OPTIONS?.includes(preload)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, preload].filter(Boolean).join(' ')
}

function isLoopback(host) {
  return host == null || /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/i.test(String(host))
}

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const host = first && typeof first === 'object' ? first.host || first.hostname
    : typeof args[1] === 'string' ? args[1] : undefined
  if (!isLoopback(host)) throw new Error('PROVIDER_TEST_OFFLINE: non-loopback socket access is forbidden')
  return connect.apply(this, args)
}

const fetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
  if (url.protocol !== 'data:' && !isLoopback(url.hostname)) {
    return Promise.reject(new Error('PROVIDER_TEST_OFFLINE: use synthetic transport or a loopback fixture'))
  }
  return fetch(input, init)
}
