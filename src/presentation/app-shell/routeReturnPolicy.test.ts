import {
  resolveConversationReturnAction,
  resolveRouteReturnIntent,
  resolveSettingsChildReturnAction,
} from './routeReturnPolicy'

describe('route return policy', () => {
  it('accepts only the closed set of return intents', () => {
    expect(resolveRouteReturnIntent('chat')).toBe('chat')
    expect(resolveRouteReturnIntent(['settings', 'chat'])).toBe('settings')
    expect(resolveRouteReturnIntent('router.push(\'/secret\')')).toBeUndefined()
    expect(resolveRouteReturnIntent(undefined)).toBeUndefined()
  })

  it('keeps explicit-origin child routes on the originating stack when possible', () => {
    expect(resolveSettingsChildReturnAction('chat', true)).toEqual({ kind: 'back' })
    expect(resolveSettingsChildReturnAction('settings', true)).toEqual({ kind: 'back' })
    expect(resolveSettingsChildReturnAction('history', true)).toEqual({ kind: 'back' })
    expect(resolveConversationReturnAction('history', true)).toEqual({ kind: 'back' })
    expect(resolveConversationReturnAction('settings', true)).toEqual({ kind: 'back' })
  })

  it('uses a closed safe fallback when an explicit origin is no longer in the stack', () => {
    expect(resolveSettingsChildReturnAction('chat', false)).toEqual({ kind: 'replace', pathname: '/' })
    expect(resolveSettingsChildReturnAction('settings', false)).toEqual({ kind: 'replace', pathname: '/settings' })
    expect(resolveSettingsChildReturnAction('history', false)).toEqual({ kind: 'replace', pathname: '/conversations' })
    expect(resolveConversationReturnAction('history', false)).toEqual({ kind: 'replace', pathname: '/conversations' })
    expect(resolveConversationReturnAction('settings', false)).toEqual({ kind: 'replace', pathname: '/settings' })
  })

  it('does not trust incidental history when no explicit origin is present', () => {
    expect(resolveConversationReturnAction(undefined, true)).toEqual({ kind: 'replace', pathname: '/conversations' })
    expect(resolveSettingsChildReturnAction(undefined, true)).toEqual({ kind: 'replace', pathname: '/settings' })
  })
})
