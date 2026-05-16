import type { PropsWithChildren } from 'react'
import { IslandChip } from '@/components/ui/IslandChip'

interface PillProps extends PropsWithChildren {
  active?: boolean
}

export function Pill({ children, active = false }: PillProps) {
  return <IslandChip active={active}>{children}</IslandChip>
}
