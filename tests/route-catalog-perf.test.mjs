// Why the Timeline was slow on a remote Desktop: every read re-ran the full
// profile/connection roster (`host.profileRoutes()`) once a 5 s route cache
// expired, so a view opened later than the first one paid it before its own call.
// These tests pin the contract: reads reuse the catalog, actions stay fresh, a
// failed read re-checks its route once without re-sending, and the Timeline is
// warmed with the same query it later reads.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NavigatorShell,
  ROUTE_CATALOG_TTL_MS,
  SessionBrowser,
  prefetchTimeline,
  requestForRoute,
  sessionListQuery
} from '../desktop-plugin/desktop/plugin.js'
import { host, queryClient, resetRouteMocks, setQueryMock } from './sdk-stub.mjs'
import { setEffectRunner } from './react-stub.mjs'

const remote = { connectionId: 'vds', mode: 'remote', profile: 'default', targetProfile: 'default' }
const legacy = { connectionId: '__legacy_active__', mode: 'legacy', profile: 'default', targetProfile: 'default' }

// A host whose roster lookups and RPCs are counted. `catalog` is what the next
// profileRoutes() call answers; `fail` makes requestProfile reject.
function countingHost({ catalog = [remote], fail = null, rosterError = null } = {}) {
  const stats = { roster: 0, rpc: [] }
  const h = {
    stats,
    catalog,
    state: { profile: { get: () => 'default' }, connectionId: { get: () => 'vds' } },
    profileRoutes: async () => {
      stats.roster += 1
      if (h.rosterError) throw h.rosterError
      return h.catalog
    },
    requestProfile: async (_route, method, params) => {
      stats.rpc.push([method, params])
      if (h.fail) throw h.fail
      return { method }
    }
  }
  h.fail = fail
  h.rosterError = rosterError
  return h
}

// Move the plugin's clock forward without waiting.
function withClockSkew(fn) {
  const realNow = Date.now
  let skew = 0
  Date.now = () => realNow() + skew
  const advance = ms => { skew += ms }
  return Promise.resolve(fn(advance)).finally(() => { Date.now = realNow })
}

test('reads reuse the route catalog long after the old 5 s window', () =>
  withClockSkew(async advance => {
    const h = countingHost()
    await requestForRoute(remote, 'projects.tree', {}, h, undefined, { fresh: true }) // Navigator open
    assert.equal(h.stats.roster, 1)

    advance(6000) // user clicks Timeline a few seconds later
    await Promise.all([
      requestForRoute(remote, 'session.list', {}, h),
      requestForRoute(remote, 'projects.tree', {}, h)
    ])
    advance(15000) // background refetch
    await requestForRoute(remote, 'session.list', {}, h)
    assert.equal(h.stats.roster, 1, 'reads inside the TTL must not re-run the roster')

    advance(ROUTE_CATALOG_TTL_MS) // staleness stays bounded
    await requestForRoute(remote, 'session.list', {}, h)
    assert.equal(h.stats.roster, 2)
  }))

test('actions still resolve the route fresh every time', async () => {
  const h = countingHost()
  await requestForRoute(remote, 'session.list', {}, h, undefined, { fresh: true })
  await requestForRoute(remote, 'session.delete', { session_id: 'a' }, h, undefined, { fresh: true })
  await requestForRoute(remote, 'session.delete', { session_id: 'b' }, h, undefined, { fresh: true })
  assert.equal(h.stats.roster, 3)
})

test('a read on a route that disappeared reports it clearly and is not re-sent', async () => {
  const h = countingHost()
  await requestForRoute(remote, 'session.list', {}, h, undefined, { fresh: true })
  h.catalog = [] // the connection was removed while the cache still lists it
  h.fail = new Error('socket closed')

  await assert.rejects(requestForRoute(remote, 'session.title', { title: 'x' }, h), {
    code: 'route_unavailable',
    message: /no longer available/
  })
  assert.equal(h.stats.rpc.filter(([m]) => m === 'session.title').length, 1, 'the call must never be sent twice')
  assert.equal(h.stats.roster, 2, 'exactly one re-check')
})

test('a read that fails on a live route keeps its own error', async () => {
  const h = countingHost()
  await requestForRoute(remote, 'session.list', {}, h, undefined, { fresh: true })
  h.fail = new Error('backend busy')
  await assert.rejects(requestForRoute(remote, 'session.list', {}, h), { message: 'backend busy' })
  assert.equal(h.stats.roster, 2)
  assert.equal(h.stats.rpc.length, 2, 'the failed call is sent once, never retried here')

  // If the re-check itself fails (network down), the original error still wins.
  h.rosterError = new Error('roster offline')
  await assert.rejects(requestForRoute(remote, 'session.list', {}, h), { message: 'backend busy' })
})

test('the Timeline prefetch warms exactly the query the Timeline reads', async () => {
  const seen = []
  setQueryMock(options => { seen.push(options); return { status: 'pending', data: null } })
  try {
    SessionBrowser({ route: legacy })
  } finally {
    setQueryMock(null)
  }
  const timelineQuery = seen.find(o => o.queryKey.includes('sessions'))
  assert.ok(timelineQuery, 'Timeline must read the sessions query')
  assert.deepEqual(timelineQuery.queryKey, sessionListQuery(legacy).queryKey)

  const prefetched = []
  prefetchTimeline(legacy, { prefetchQuery: async options => { prefetched.push(options) } })
  assert.equal(prefetched.length, 1)
  assert.deepEqual(prefetched[0].queryKey, timelineQuery.queryKey)
  assert.equal(prefetched[0].refetchInterval, undefined, 'a prefetch must not start a poll')

  // No route or an older host without prefetchQuery: quietly does nothing.
  prefetchTimeline(null, { prefetchQuery: async () => assert.fail('no route, no fetch') })
  prefetchTimeline(legacy, {})
})

test('opening the Navigator starts the Timeline prefetch', async () => {
  resetRouteMocks()
  const prefetched = []
  const original = queryClient.prefetchQuery
  const connection = host.state.connectionId.get()
  host.state.connectionId.set('') // legacy host: the active profile is selected on first render
  queryClient.prefetchQuery = async options => { prefetched.push(options) }
  setEffectRunner(effect => { effect() })
  try {
    NavigatorShell({})
  } finally {
    setEffectRunner(null)
    host.state.connectionId.set(connection)
    if (original) queryClient.prefetchQuery = original
    else delete queryClient.prefetchQuery
  }
  const warmed = prefetched.filter(o => o.queryKey.includes('sessions'))
  assert.equal(warmed.length, 1)
  assert.deepEqual(warmed[0].queryKey, sessionListQuery(legacy).queryKey)
})
