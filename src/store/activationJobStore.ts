import { create } from 'zustand'

export type ActivationJobStatus = 'running' | 'done' | 'failed'
export type ActivationJobItemStatus = 'queued' | 'running' | 'done' | 'failed'

export interface ActivationJobItemState {
  providerId: string
  providerName: string
  status: ActivationJobItemStatus
  progress: number
  synced: boolean
  tested: boolean
  failed: boolean
  stage?: string
}

export interface ActivationJobIssueGroupState {
  key: string
  message: string
  count: number
  providerNames: string[]
  hiddenProviderCount: number
  line: string
}

export interface ActivationJobState {
  id: string
  status: ActivationJobStatus
  total: number
  completed: number
  progress?: number
  synced: number
  tested: number
  failed: number
  currentName?: string
  stage?: string
  items?: ActivationJobItemState[]
  issueGroups?: ActivationJobIssueGroupState[]
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

export function resolveActivationJobProgress(job: Pick<ActivationJobState, 'total' | 'completed' | 'progress' | 'items'>): number {
  const completedProgress = job.total > 0 ? job.completed / job.total : 0
  const itemProgress = job.items?.length
    ? job.items.reduce((sum, item) => sum + clampProgress(item.progress), 0) / job.items.length
    : undefined
  return clampProgress(Math.max(completedProgress, itemProgress ?? 0, job.progress ?? completedProgress))
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export const useActivationJobStore = create<ActivationJobStore>((set) => ({
  job: null,
  start: (job) => set({ job: { ...job, id: jobId(), updatedAt: Date.now() } }),
  update: (updates) => set((state) => state.job ? { job: { ...state.job, ...updates, updatedAt: Date.now() } } : state),
  finish: (updates) => set((state) => state.job ? { job: { ...state.job, ...updates, updatedAt: Date.now() } } : state),
  clear: () => set({ job: null }),
}))
