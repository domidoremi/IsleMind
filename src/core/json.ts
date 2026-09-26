export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type JsonRecord = Readonly<Record<string, JsonValue>>

export class JsonTextBudgetError extends Error {
  constructor() { super('JSON input exceeds the managed text limit'); this.name = 'JsonTextBudgetError' }
}

/** Preflight before cloning/stringifying: bounds source text and traversal work
 * without creating a second serialized copy. Escaping can enlarge JSON, so the
 * consumer must still enforce its existing post-serialization limit. */
export function assertJsonTraversalBudget(value: unknown, maxCharacters: number, maxNodes = 100_000): void {
  traverseJson(value, maxCharacters, maxNodes, false)
}

/** Conservative serialized character count, without allocating a JSON copy.
 * Includes escaping and repeated references; retains the same plain-data,
 * accessor, depth and node guards as the preflight traversal. */
export function measureJsonCharacters(value: unknown, maxCharacters = 8 * 1024 * 1024, maxNodes = 100_000): number {
  return traverseJson(value, maxCharacters, maxNodes, true)
}

function traverseJson(value: unknown, maxCharacters: number, maxNodes: number, serialized: boolean): number {
  let characters = 0
  let nodes = 0
  const ancestors = new WeakSet<object>()
  const add = (count: number) => {
    characters += count
    if (characters > maxCharacters) throw new JsonTextBudgetError()
  }
  const stringCharacters = (text: string): number => {
    if (!serialized) return text.length + 2
    let count = text.length + 2
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) count++
      else if (code < 32) count += 5
      else if (code >= 0xd800 && code <= 0xdfff) {
        if (code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) index++
        else count += 5
      }
      if (count > maxCharacters) throw new JsonTextBudgetError()
    }
    return count
  }
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > maxNodes || depth > 32) throw new Error('JSON input exceeds the traversal limit')
    if (typeof item === 'string') { add(stringCharacters(item)); return }
    if (item === undefined || item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) {
      add(serialized ? item === undefined ? 4 : String(item).length : 4); return
    }
    if (typeof item !== 'object' || ancestors.has(item)) throw new Error('JSON input is not acyclic plain data')
    const prototype = Object.getPrototypeOf(item)
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new Error('JSON input must be plain data')
    // JSON.stringify consults toJSON even when it is non-enumerable/inherited.
    if ('toJSON' in item) {
      const hook = Object.getOwnPropertyDescriptor(item, 'toJSON')
      if (!hook || !('value' in hook) || typeof hook.value === 'function') throw new Error('JSON input cannot contain serialization hooks')
    }
    ancestors.add(item)
    add(2)
    if (Array.isArray(item)) {
      // Holes also become JSON nulls. Enumeration would miss their cost as
      // well as non-enumerable or inherited indexed getters.
      if (item.length > maxNodes - nodes) throw new Error('JSON input exceeds the traversal limit')
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index))
        if (descriptor && !('value' in descriptor) || !descriptor && index in item) throw new Error('JSON input cannot contain accessors or inherited indices')
        add(1)
        visit(descriptor?.value, depth + 1)
      }
      ancestors.delete(item)
      return
    }
    // Iterate lazily rather than making a potentially huge Object.entries copy.
    for (const key in item) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) continue
      add(stringCharacters(key) + (serialized ? 2 : 1))
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!
      if (!('value' in descriptor)) throw new Error('JSON input cannot contain accessors')
      visit(descriptor.value, depth + 1)
    }
    ancestors.delete(item)
  }
  visit(value, 0)
  return characters
}
