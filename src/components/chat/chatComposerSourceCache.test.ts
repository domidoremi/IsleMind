import {
  invalidateComposerSourceCache,
  loadComposerSourceSnapshot,
} from './chatComposerSourceCache'
import type { SkillDefinition } from '@/types/skillContracts'

function createSkill(id: string): SkillDefinition {
  return {
    schema: 'islemind.skill.v1',
    id,
    name: 'One',
    description: '',
    layer: 'base',
    tags: [],
    priority: 1,
    systemPrompt: '',
    variables: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('chat composer source cache', () => {
  beforeEach(() => {
    invalidateComposerSourceCache()
  })

  it('reuses the short-lived snapshot after the first source read', async () => {
    const calls = { skills: 0, documents: 0, memories: 0 }
    const loaders = {
      loadSkills: async () => {
        calls.skills += 1
        return [createSkill('skill-1')]
      },
      loadDocuments: async () => {
        calls.documents += 1
        return []
      },
      loadMemories: async () => {
        calls.memories += 1
        return []
      },
    }

    const first = await loadComposerSourceSnapshot(loaders)
    const second = await loadComposerSourceSnapshot(loaders)
    const third = await loadComposerSourceSnapshot({
      loadSkills: async () => {
        throw new Error('cache should be used')
      },
      loadDocuments: async () => {
        throw new Error('cache should be used')
      },
      loadMemories: async () => {
        throw new Error('cache should be used')
      },
    })

    expect(first).toBe(second)
    expect(third).toBe(first)
    expect(calls).toEqual({ skills: 1, documents: 1, memories: 1 })
  })

  it('fails open per optional source without hiding a successful source', async () => {
    const snapshot = await loadComposerSourceSnapshot({
      loadSkills: async () => [createSkill('skill-1')],
      loadDocuments: async () => {
        throw new Error('documents unavailable')
      },
      loadMemories: async () => [{ id: 'memory-1', content: 'remember', status: 'active', createdAt: 1, updatedAt: 1 }],
    })

    expect(snapshot.skills).toHaveLength(1)
    expect(snapshot.documents).toEqual([])
    expect(snapshot.memories).toHaveLength(1)
  })

  it('coalesces concurrent source reads into one shared request', async () => {
    const skillsGate = deferred<SkillDefinition[]>()
    const calls = { skills: 0, documents: 0, memories: 0 }
    const loaders = {
      loadSkills: async () => {
        calls.skills += 1
        return skillsGate.promise
      },
      loadDocuments: async () => {
        calls.documents += 1
        return []
      },
      loadMemories: async () => {
        calls.memories += 1
        return []
      },
    }

    const firstPromise = loadComposerSourceSnapshot(loaders)
    const secondPromise = loadComposerSourceSnapshot(loaders)
    expect(calls).toEqual({ skills: 1, documents: 1, memories: 1 })
    skillsGate.resolve([createSkill('shared')])

    const [first, second] = await Promise.all([firstPromise, secondPromise])
    expect(first).toBe(second)
  })

  it('does not cancel a shared request when one caller leaves', async () => {
    const skillsGate = deferred<SkillDefinition[]>()
    const leaving = new AbortController()
    const loaders = {
      loadSkills: async () => skillsGate.promise,
      loadDocuments: async () => [],
      loadMemories: async () => [],
    }

    const firstPromise = loadComposerSourceSnapshot(loaders, leaving.signal)
    const secondPromise = loadComposerSourceSnapshot(loaders)
    leaving.abort()
    skillsGate.resolve([createSkill('surviving')])

    await expect(firstPromise).rejects.toMatchObject({ name: 'AbortError' })
    await expect(secondPromise).resolves.toMatchObject({ skills: [{ id: 'surviving' }] })
  })

  it('does not let an invalidated in-flight result repopulate the cache', async () => {
    const staleSkills = deferred<SkillDefinition[]>()
    const staleLoad = loadComposerSourceSnapshot({
      loadSkills: async () => staleSkills.promise,
      loadDocuments: async () => [],
      loadMemories: async () => [],
    })
    invalidateComposerSourceCache()
    const fresh = await loadComposerSourceSnapshot({
      loadSkills: async () => [createSkill('fresh')],
      loadDocuments: async () => [],
      loadMemories: async () => [],
    })
    staleSkills.resolve([createSkill('stale')])

    await expect(staleLoad).rejects.toMatchObject({ name: 'AbortError' })
    const cached = await loadComposerSourceSnapshot({
      loadSkills: async () => {
        throw new Error('fresh cache should be used')
      },
      loadDocuments: async () => {
        throw new Error('fresh cache should be used')
      },
      loadMemories: async () => {
        throw new Error('fresh cache should be used')
      },
    })
    expect(cached).toBe(fresh)
  })

  it('invalidates a resolved snapshot before the next read', async () => {
    let calls = 0
    const loaders = {
      loadSkills: async () => {
        calls += 1
        return []
      },
      loadDocuments: async () => [],
      loadMemories: async () => [],
    }

    await loadComposerSourceSnapshot(loaders)
    invalidateComposerSourceCache()

    const fresh = await loadComposerSourceSnapshot({
      loadSkills: async () => {
        calls += 1
        return []
      },
      loadDocuments: async () => [],
      loadMemories: async () => [],
    })

    expect(fresh.documents).toEqual([])
    expect(calls).toBe(2)
  })
})
