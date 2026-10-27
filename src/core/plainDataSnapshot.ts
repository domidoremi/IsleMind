/** Detaches operation data, never controllers, signals, adapters or callbacks. */
export function snapshotPlainData<Value>(
  value: Value,
  snapshots: WeakMap<object, unknown> = new WeakMap(),
): Value {
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('Operation snapshots must contain plain data.')
  }
  if (value === null || typeof value !== 'object') return value

  const source = value as object
  if (snapshots.has(source)) return snapshots.get(source) as Value
  assertPlainObject(source)
  if (isDeeplyFrozen(source)) {
    snapshots.set(source, source)
    return value
  }

  const snapshot = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(Object.getPrototypeOf(source)) as object
  snapshots.set(source, snapshot)
  for (const key of Object.getOwnPropertyNames(source)) {
    if (Array.isArray(value) && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(source, key)!
    if (!('value' in descriptor)) throw new Error('Operation snapshots cannot contain accessors.')
    Object.defineProperty(snapshot, key, {
      value: snapshotPlainData(descriptor.value, snapshots),
      enumerable: descriptor.enumerable,
      writable: true,
      configurable: true,
    })
  }
  return Object.freeze(snapshot) as Value
}

function assertPlainObject(value: object): void {
  const prototype = Object.getPrototypeOf(value)
  const plain = Array.isArray(value)
    ? prototype === Array.prototype || prototype === null
    : prototype === Object.prototype || prototype === null
  if (!plain || Object.getOwnPropertySymbols(value).length) {
    throw new Error('Operation snapshots must use plain objects and arrays.')
  }
}

function isDeeplyFrozen(value: object): boolean {
  const pending = [value]
  const seen = new WeakSet<object>()
  while (pending.length) {
    const current = pending.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    assertPlainObject(current)
    if (!Object.isFrozen(current)) return false
    for (const key of Object.getOwnPropertyNames(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!
      if (!('value' in descriptor)) throw new Error('Operation snapshots cannot contain accessors.')
      const child: unknown = descriptor.value
      if (typeof child === 'function' || typeof child === 'symbol') {
        throw new Error('Operation snapshots must contain plain data.')
      }
      if (child !== null && typeof child === 'object') pending.push(child)
    }
  }
  return true
}
