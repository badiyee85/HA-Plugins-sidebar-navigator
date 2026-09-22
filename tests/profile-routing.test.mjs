import test from 'node:test'
import assert from 'node:assert/strict'
import * as navigatorPlugin from '../desktop-plugin/desktop/plugin.js'

const {
  activeRouteFrom,
  duplicateProfileNames,
  focusedOnRoute,
  normalizeRoute,
  normalizeRoutes,
  openSessionForRoute,
  queryKey,
  reconcileBrowseState,
  reconcileRoute,
  requestForRoute,
  routeKey,
  routeLabel,
  rowKey,
  storageKey
} = navigatorPlugin

const local = { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' }
const remoteDefault = { connectionId: 'desk-remote', mode: 'remote', profile: 'default', targetProfile: 'default' }
const remoteWorker = { connectionId: 'desk-remote', mode: 'remote', profile: 'worker', targetProfile: 'worker' }
const legacy = { connectionId: '__legacy_active__', mode: 'legacy', profile: 'default', targetProfile: 'default' }

test('profile route identity stays source-qualified', async t => {
  await t.test('same profile on different connections remains distinct', () => {
    assert.deepEqual(normalizeRoute(local), local)
    assert.deepEqual(normalizeRoute(legacy), legacy)
    assert.equal(normalizeRoute({ profile: 'default' }), null)
    assert.equal(normalizeRoute({ connectionId: 'local', profile: 'default' }), null)
    assert.equal(normalizeRoute({ connectionId: 'desk-remote', mode: 'remote', profile: 'default' }), null)
    assert.equal(normalizeRoute({ connectionId: 'desk-remote', mode: 'remote', profile: 'default', targetProfile: '   ' }), null)
    assert.notEqual(routeKey(local), routeKey(remoteDefault))
    assert.deepEqual(normalizeRoutes([local, remoteDefault, remoteDefault]), [local, remoteDefault])
    assert.deepEqual(normalizeRoutes([remoteWorker, { ...remoteWorker, targetProfile: 'other-worker' }]), [])
    assert.deepEqual(activeRouteFrom([local, remoteDefault], 'desk-remote', 'default'), remoteDefault)
    assert.deepEqual(activeRouteFrom([], null, 'default'), legacy)
  })

  await t.test('duplicate labels are disambiguated without an aggregate scope', () => {
    const duplicates = duplicateProfileNames([local, remoteDefault, remoteWorker])
    assert.equal(routeLabel(local, duplicates), 'default · local')
    assert.equal(routeLabel(remoteDefault, duplicates), 'default · desk-remote')
  })

  await t.test('exact route reconciliation rejects replacement metadata', () => {
    assert.deepEqual(reconcileRoute(remoteDefault, [remoteDefault]), remoteDefault)
    assert.equal(reconcileRoute(remoteDefault, [{ ...remoteDefault, targetProfile: 'other-backend' }]), null)
  })
})

test('browse state is independent from active Desktop state', () => {
  const manual = reconcileBrowseState(
    { manual: true, selected: remoteWorker, unavailable: null },
    [local, remoteWorker],
    'local',
    'default'
  )
  assert.equal(manual.manual, true)
  assert.deepEqual(manual.selected, remoteWorker)

  const activeOnly = reconcileBrowseState(
    { manual: false, selected: null, unavailable: null },
    [local, remoteWorker],
    'local',
    'default'
  )
  assert.deepEqual(activeOnly.selected, local)

  const disappeared = reconcileBrowseState(
    { manual: true, selected: remoteWorker, unavailable: null },
    [local],
    'local',
    'default'
  )
  assert.equal(disappeared.selected, null)
  assert.deepEqual(disappeared.unavailable, remoteWorker)
})

test('cache, row, focus, and presentation identities include the route', () => {
  assert.deepEqual(queryKey('sessions', local), ['ha-sidebar-navigator', 'sessions', 'local', 'default', 'local', 'default'])
  assert.deepEqual(queryKey('sessions', remoteDefault), ['ha-sidebar-navigator', 'sessions', 'desk-remote', 'default', 'remote', 'default'])
  assert.notEqual(rowKey(local, 'same-session'), rowKey(remoteDefault, 'same-session'))
  assert.notEqual(storageKey('colors', local), storageKey('colors', remoteDefault))
  assert.equal(focusedOnRoute({ connectionId: 'desk-remote', profile: 'worker' }, remoteWorker, 'same-session', 'same-session'), true)
  assert.equal(focusedOnRoute({ connectionId: 'local', profile: 'default' }, remoteWorker, 'same-session', 'same-session'), false)
  assert.equal(focusedOnRoute({ connectionId: null, profile: 'default' }, legacy, 'same-session', 'same-session'), true)
  assert.equal(focusedOnRoute({ connectionId: 'local', profile: 'default' }, legacy, 'same-session', 'same-session'), false)
  assert.equal(focusedOnRoute(null, remoteWorker, 'same-session', 'same-session'), false)
})

test('route-aware transport never silently falls back to the active gateway', async () => {
  const calls = []
  const host = {
    request: async (...args) => calls.push(['active', ...args]),
    requestProfile: async (...args) => calls.push(['route', ...args]),
    profileRoutes: async () => [remoteWorker]
  }
  await requestForRoute(remoteWorker, 'session.list', {}, host, { connectionId: 'local', profile: 'default' })
  assert.deepEqual(calls, [['route', remoteWorker, 'session.list', {}]])

  const legacyCalls = []
  const legacyHost = { request: async (...args) => legacyCalls.push(args), state: { profile: 'default' } }
  await requestForRoute(legacy, 'session.list', {}, legacyHost, { connectionId: null, profile: 'default' })
  assert.deepEqual(legacyCalls, [['session.list', {}]])
  await assert.rejects(
    requestForRoute(remoteWorker, 'session.list', {}, { ...legacyHost, profileRoutes: undefined }, { connectionId: 'local', profile: 'default' }),
    /only browse the active profile/
  )

  const staleHost = {
    requestProfile: async () => {},
    profileRoutes: async () => [{ ...remoteWorker, targetProfile: 'other-worker' }]
  }
  await assert.rejects(requestForRoute(remoteWorker, 'session.list', {}, staleHost), /no longer available/)

  const resolvers = []
  const deferredHost = {
    profileRoutes: () => new Promise(resolve => { resolvers.push(resolve) }),
    requestProfile: async (...args) => calls.push(['deferred', ...args])
  }
  const pending = requestForRoute(remoteWorker, 'session.list', {}, deferredHost)
  // A second fresh discovery supersedes the first promise; both callers still
  // reconcile against the returned route rather than a stale cache entry.
  const stalePending = requestForRoute(remoteWorker, 'session.title', {}, deferredHost, undefined, { fresh: true })
  resolvers.forEach(resolve => resolve([remoteWorker]))
  await pending
  await stalePending
})

test('session opening activates the exact owner without enabling aggregate scope', async () => {
  const calls = []
  const host = {
    profileRoutes: async () => [remoteWorker],
    ensureAgent: async (...args) => calls.push(['ensure', ...args]),
    openSession: async (...args) => calls.push(['open', ...args]),
    navigate: () => { throw new Error('ID-only navigation must not be used') }
  }
  await openSessionForRoute(remoteWorker, 'same-session', 'in-place', host)
  assert.deepEqual(calls, [
    ['ensure', remoteWorker.connectionId, remoteWorker.profile],
    ['open', 'same-session', {
      profile: remoteWorker.profile,
      intent: 'in-place',
      keepAllProfilesScope: false
    }]
  ])
})

test('older route-aware hosts fail closed instead of enabling aggregate scope', async () => {
  const calls = []
  const host = {
    profileRoutes: async () => [remoteWorker],
    openSession: async (sessionId, options) => calls.push([sessionId, options])
  }

  await assert.rejects(
    openSessionForRoute(remoteWorker, 'foreign-session', 'window', host),
    /without aggregate scope is unavailable/
  )
  assert.deepEqual(calls, [])
})

test('legacy active-only session opening never invents a connection identity', async () => {
  const calls = []
  const host = { openSession: async (...args) => calls.push(args) }
  await openSessionForRoute(legacy, 'legacy-session', 'in-place', host)
  assert.deepEqual(calls, [['legacy-session', {
    profile: 'default',
    intent: 'in-place',
    keepAllProfilesScope: false
  }]])
})
