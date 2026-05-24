import { create } from 'zustand'

export type ActivationJobStatus = 'running' | 'done' | 'failed'

export interface ActivationJobState {
  id: string
  status: ActivationJobStatus
  total: number
  completed: number
  synced: number
  tested: number
  failed: number
  currentName?: string
  stage?: string
  updatedAt: number
}

interface ActivationJobStore {
  job: ActivationJobState | null
  start: (job: Omit<ActivationJobState, 'id' | 'updatedAt'>) => void
  update: (updates: Partial<Omit<ActivationJobState, 'id' | 'updatedAt'>>) => void
  finish: (updates: Partial<Omit<ActivationJobState, 'id' | 'updatedAt'>>) => void
  clear: () => void
}

function jobId(): string {
  return `activation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export const useActivationJobStore = create<ActivationJobStore>((set) => ({
  job: null,
  start: (job) => set({ job: { ...job, id: jobId(), updatedAt: Date.now() } }),
  update: (updates) => set((state) => state.job ? { job: { ...state.job, ...updates, updatedAt: Date.now() } } : state),
  finish: (updates) => set((state) => state.job ? { job: { ...state.job, ...updates, updatedAt: Date.now() } } : state),
  clear: () => set({ job: null }),
}))
