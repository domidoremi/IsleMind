import type { MessageCitation } from '@/types/contextContracts'
import { buildSourceCitationNavigation } from './sourceCitationSelection'

const citations: MessageCitation[] = [
  { id: 'first', type: 'knowledge', title: 'First' },
  { id: 'ambiguous', type: 'knowledge', title: 'Duplicate A' },
  { id: 'second', type: 'memory', title: 'Second' },
  { id: 'ambiguous', type: 'web', title: 'Duplicate B' },
  { id: 'third', type: 'web', title: 'Third' },
]

it('moves only between unique explicit identities without relabeling captured positions', () => {
  const model = buildSourceCitationNavigation(citations, 'second')
  expect(model.selected).toBe(citations[2])
  expect(model.selectedIndex).toBe(2)
  expect(model.previous?.id).toBe('first')
  expect(model.next?.id).toBe('third')
  expect(model.selectable.has('ambiguous')).toBe(false)
  expect(citations.map(citation => citation.id)).toEqual(['first', 'ambiguous', 'second', 'ambiguous', 'third'])
})

it.each(['missing', 'ambiguous', undefined])('does not recover %s by silently selecting a peer', id => {
  const model = buildSourceCitationNavigation(citations, id)
  expect(model.selected).toBeUndefined()
  expect(model.selectedIndex).toBe(-1)
  expect(model.previous).toBeUndefined()
  expect(model.next).toBeUndefined()
})
