// Why the Timeline was slow on a remote Desktop: every read re-ran the full
// profile/connection roster (`host.profileRoutes()`) before its own call once a
// 5 s route cache expired, so a view opened later than the first one paid it.
// These tests pin the contract that replaced it, without losing the old safety:
// - a read never waits for the roster; the roster is re-checked in the background
//   at most every 5 s, one lookup at a time;
// - a route the re-check finds gone or replaced is invalidated and the next read
//   reports it instead of showing another backend's sessions;
// - a failed read is never re-sent, shares the lookup in flight, and keeps its own
//   error unless the route is really gone;
// - actions always resolve the route fresh;
// - the Timeline is warmed with the same query it later reads.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NavigatorShell,
  ROUTE_CATALOG_TTL_MS,
  SessionBrowser,
  prefetchTimeline,
  queryKey,
  requestForRoute,
  sessionListQuery
} from '../desktop-plugin/desktop/plugin.js'
import { host, queryClient, resetRouteMocks, setQueryMock } from './sdk-stub.mjs'
import { setEffectRunner } from './react-stub.mjs'

const remote = { connectionId: 'vds', mode: 'remote', profile: 'default', targetProfile: 'default' }
const legacy = { connectionId: '__legacy_active__', mode: 'legacy', profile: 'default', targetProfile: 'default' }
const tick = () => new Promise(resolve => setImmediate(resolve))

// A host whose roster lookups and RPCs are counted. `catalog` is what the next
// profileRoutes() call answers; `hold()` makes the next lookups wait until
// `release()`; `fail` makes requestProfile reject.
function countingHost({ catalog = [remote] } = {}) {
  const stats = { roster: 0, rpc: [] }
  let gate = null
  const h = {
    stats,
    catalog,
    fail: null,
    rosterError: null,
    state: { profile: { get: () => 'default' }, connectionId: { get: () => 'vds' } },
    hold() { let open; gate = { promise: new Promise(r => { open = r }), open } },
    release() { const g = gate; gate = null; g?.open() },
    profileRoutes: async () => {
      stats.roster += 1
      if (gate) await gate.promise
      if (h.rosterError) throw h.rosterError
      return h.catalog
    },
    requestProfile: async (_route, method, params) => {
      stats.rpc.push([method, params])
      if (h.fail) throw h.fail
      return { method }
    }
  }
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

// Record which query keys the plugin invalidates.
async function withInvalidationSpy(fn) {
  const original = queryClient.invalidateQueries
  const keys = []
  queryClient.invalidateQueries = async ({ queryKey: key }) => { keys.push(key) }
  try {
    return await fn(keys)
  } finally {
    queryClient.invalidateQueries = original
  }
}

test('a read never waits for the roster lookup', () =>
  withClockSkew(async advance => {
    const h = countingHost()
    await requestForRoute(remote, 'projects.tree', {}, h, undefined, { fresh: true }) // Navigator open
    assert.equal(h.stats.roster, 1)

    advance(6000) // the user clicks Timeline a few seconds later
    h.hold() // and the roster lookup is slow
    const answered = await requestForRoute(remote, 'session.list', {}, h)
    assert.equal(answered.method, 'session.list', 'the read is answered while the lookup is still pending')
    assert.equal(h.stats.roster, 2, 'the lookup runs, but in the background')

    await requestForRoute(remote, 'projects.tree', {}, h)
    assert.equal(h.stats.roster, 2, 'one lookup at a time')
    h.release()
    await tick()

    await requestForRoute(remote, 'session.list', {}, h)
    assert.equal(h.stats.roster, 2, 'no new lookup within 5 s of the last one')

    advance(6000) // 15 s refetch: re-checked again, still without waiting
    await requestForRoute(remote, 'session.list', {}, h)
    assert.equal(h.stats.roster, 3)
    await tick()
  }))

test('a read still resolves fresh when the catalog is older than the hard limit', () =>
  withClockSkew(async advance => {
    const h = countingHost()
    await requestForRoute(remote, 'session.list', {}, h, undefined, { fresh: true })
    advance(ROUTE_CATALOG_TTL_MS + 1000)
    h.catalog = []
    await assert.rejects(requestForRoute(remote, 'session.list', {}, h), { code: 'route_unavailable' })
    assert.equal(h.stats.rpc.length, 1, 'nothing sent on a route that is gone')
  }))

test('actions still resolve the route fresh every time', async () => {
  const h = countingHost()
  await requestForRoute(remote, 'session.list', {}, h, undefined, { fresh: true })
  await requestForRoute(remote, 'session.delete', { session_id: 'a' }, h, undefined, { fresh: true })
  await requestForRoute(remote, 'session.delete', { session_id: 'b' }, h, undefined, { fresh: true })
  assert.equal(h.stats.roster, 3)
})

for (const [label, change] of [
  ['removed', () => []],
  ['replaced by another backend profile', () => [{ ...remote, targetProfile: 'someone-else' }]]
]) {
  test(`a route ${label} while the Navigator is open is caught by the background re-check`, () =>
    withInvalidationSpy(keys =>
      withClockSkew(async advance => {
        const h = countingHost()
        await requestForRoute(remote, 'session.list', {}, h, undefined, { fresh: true })
        advance(6000)
        h.catalog = change()
        await requestForRoute(remote, 'session.list', {}, h) // served, re-check runs behind it
        await tick()
        assert.ok(
          keys.some(key => JSON.stringify(key) === JSON.stringify(queryKey('sessions', remote))),
          'the Navigator queries for that route are invalidated'
        )
        const sent = h.stats.rpc.length
        await assert.rejects(requestForRoute(remote, 'session.list', {}, h), { code: 'route_unavailable' })
        assert.equal(h.stats.rpc.length, sent, 'the next read is not sent to the old route')
      })))
}

test('a failed read on a route that disappeared says so and is not re-sent', () =>
  withClockSkew(async advance => {
    const h = countingHost()
    await requestForRoute(remote, 'session.list', {}, h, undefined, { fresh: true })
    advance(6000)
    h.catalog = [] // the connection was removed
    h.fail = new Error('socket closed')
    await assert.rejects(requestForRoute(remote, 'session.title', { title: 'x' }, h), {
      code: 'route_unavailable',
      message: /no longer available/
    })
    assert.equal(h.stats.rpc.filter(([m]) => m === 'session.title').length, 1, 'the call must never be sent twice')
    assert.equal(h.stats.roster, 2, 'it reused the background lookup, no extra one')
  }))

test('failed reads keep their own error and do not start a lookup storm', () =>
  withClockSkew(async advance => {
    const h = countingHost()
    await requestForRoute(remote, 'session.list', {}, h, undefined, { fresh: true })
    h.fail = new Error('backend busy')

    // Within 5 s of a lookup: the catalog is as fresh as it ever was, no new lookup.
    await assert.rejects(requestForRoute(remote, 'session.list', {}, h), { message: 'backend busy' })
    assert.equal(h.stats.roster, 1)
    assert.equal(h.stats.rpc.length, 2, 'the failed call is sent once, never retried here')

    // An outage later on: four failing reads (and their retries) share one lookup.
    advance(6000)
    h.hold()
    const failures = [1, 2, 3, 4].map(() => requestForRoute(remote, 'session.list', {}, h).catch(e => e))
    await tick()
    h.release()
    const errors = await Promise.all(failures)
    assert.deepEqual(errors.map(e => e.message), Array(4).fill('backend busy'))
    assert.equal(h.stats.roster, 2)

    // If the lookup itself fails (network down), the original error still wins.
    advance(6000)
    h.rosterError = new Error('roster offline')
    await assert.rejects(requestForRoute(remote, 'session.list', {}, h), { message: 'backend busy' })
  }))

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
