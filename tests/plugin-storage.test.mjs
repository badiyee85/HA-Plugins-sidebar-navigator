import assert from 'node:assert/strict'
import test from 'node:test'
import plugin, {
  addSessionTag,
  copyText,
  getAllRouteTags,
  getSessionColorOverride,
  getSessionTags,
  isActiveRoute,
  isSessionPinned,
  readSessionTagsMap,
  setPluginContext,
  setPluginStorage,
  setSessionColorOverride,
  toggleSessionPin,
  toggleSessionUnread
} from '../desktop-plugin/desktop/plugin.js'
import { host } from './sdk-stub.mjs'

// A ctx.storage double that exposes its backing map so tests can see exactly
// what the plugin wrote and under which key.
function fakeCtxStorage() {
  const backing = new Map()
  return {
    backing,
    get: (key, fallback) => (backing.has(key) ? JSON.parse(backing.get(key)) : fallback),
    set: (key, value) => { backing.set(key, JSON.stringify(value)) },
    remove: key => { backing.delete(key) }
  }
}

// Any touch of the page's localStorage or the private Electron bridge is a leak.
function installTripwires() {
  const touched = []
  const trap = name => new Proxy({}, {
    get: (_t, prop) => { touched.push(`${name}.${String(prop)}`); return () => { throw new Error(`${name} used`) } }
  })
  globalThis.window = { localStorage: trap('localStorage'), hermesDesktop: trap('hermesDesktop'), dispatchEvent: () => touched.push('dispatchEvent') }
  return touched
}
function removeTripwires() {
  delete globalThis.window
}

const legacy = (profile = 'default') => ({ connectionId: '__legacy_active__', mode: 'legacy', profile, targetProfile: profile })
const otherLocal = { connectionId: 'laptop', mode: 'remote', profile: 'worker', targetProfile: 'worker' }

function withSessionsSpy(fn) {
  const calls = []
  const prior = host.sessions
  host.sessions = {
    pin: (...args) => calls.push(['pin', ...args]),
    setColor: (...args) => calls.push(['setColor', ...args])
  }
  return Promise.resolve(fn(calls)).finally(() => { host.sessions = prior })
}

test('register() adopts ctx.storage as the only persistence for tags', () => {
  const storage = fakeCtxStorage()
  const registered = []
  plugin.register({ storage, os: {}, register: c => registered.push(c) })
  const touched = installTripwires()
  try {
    const route = legacy('tags-profile')
    addSessionTag('s1', 'Bug', route)
    assert.deepEqual(getSessionTags('s1', route), ['bug'])
    assert.deepEqual(getAllRouteTags(route), ['bug'])
    assert.ok(storage.backing.size === 1, 'tags landed in ctx.storage')
    // The only sanctioned page-storage access is the one-time legacy-tags lookup.
    assert.deepEqual([...new Set(touched)], ['localStorage.getItem'], 'no writes, no hermesDesktop, no synthetic events')
    assert.equal(touched.length, 1, 'the legacy lookup runs once per route, not on every read')
  } finally {
    removeTripwires()
    setPluginStorage(null)
    setPluginContext({})
  }
})

test('tags are scoped per profile route inside ctx.storage', () => {
  const storage = fakeCtxStorage()
  setPluginStorage(storage)
  addSessionTag('s1', 'a', legacy('p1'))
  addSessionTag('s1', 'b', legacy('p2'))
  assert.deepEqual(getSessionTags('s1', legacy('p1')), ['a'])
  assert.deepEqual(getSessionTags('s1', legacy('p2')), ['b'])
  assert.equal(storage.backing.size, 2)
  setPluginStorage(null)
})

test('legacy localStorage tags migrate into ctx.storage exactly once and are removed', () => {
  const storage = fakeCtxStorage()
  setPluginStorage(storage)
  const route = legacy('migrating')
  const key = `hermes.desktop.sessionTags.v2.${encodeURIComponent('__legacy_active__')}.migrating`
  const ls = new Map([[key, JSON.stringify({ s1: ['old', 'Keep-Me'], s2: [] })]])
  globalThis.window = {
    localStorage: { getItem: k => ls.get(k) ?? null, removeItem: k => ls.delete(k), setItem: () => { throw new Error('no writes to localStorage') } }
  }
  try {
    assert.deepEqual(readSessionTagsMap(route), { s1: ['old', 'keep-me'] })
    assert.equal(ls.has(key), false, 'legacy entry deleted after import')
    assert.equal(storage.backing.size, 1, 'imported into ctx.storage')

    // A stale legacy entry reappearing must not clobber what ctx.storage now owns.
    ls.set(key, JSON.stringify({ s9: ['ghost'] }))
    assert.deepEqual(readSessionTagsMap(route), { s1: ['old', 'keep-me'] })
  } finally {
    removeTripwires()
    setPluginStorage(null)
  }
})

test('pin: active profile also pins the real sidebar row; other profiles stay navigator-only', async () => {
  const storage = fakeCtxStorage()
  setPluginStorage(storage)
  const touched = installTripwires()
  try {
    await withSessionsSpy(async calls => {
      const active = legacy('default') // host.state.profile is 'default'
      assert.equal(isActiveRoute(active), true)
      assert.equal(await toggleSessionPin('s1', false, active), true)
      assert.deepEqual(calls, [['pin', 's1', true]])
      assert.equal(isSessionPinned('s1', {}, active), true)
      assert.equal(await toggleSessionPin('s1', true, active), false)
      assert.deepEqual(calls.at(-1), ['pin', 's1', false])
      assert.equal(isSessionPinned('s1', {}, active), false)

      calls.length = 0
      for (const elsewhere of [legacy('someone-else'), otherLocal]) {
        assert.equal(isActiveRoute(elsewhere), false)
        assert.equal(await toggleSessionPin('s2', false, elsewhere), true)
        assert.equal(isSessionPinned('s2', {}, elsewhere), true, 'remembered by the navigator')
      }
      assert.deepEqual(calls, [], 'host.sessions is never touched for a profile the window is not showing')
    })
    assert.deepEqual(touched, [])
  } finally {
    removeTripwires()
    setPluginStorage(null)
  }
})

test('a session the backend already marks pinned reads as pinned', () => {
  assert.equal(isSessionPinned('x', { pinned: true }, legacy()), true)
})

test('colour: stored per route, mirrored to the sidebar only for the active profile, null clears', async () => {
  const storage = fakeCtxStorage()
  setPluginStorage(storage)
  try {
    await withSessionsSpy(calls => {
      const active = legacy('default')
      setSessionColorOverride('s1', '#112233', active)
      assert.equal(getSessionColorOverride('s1', active), '#112233')
      assert.deepEqual(calls, [['setColor', 's1', '#112233']])

      setSessionColorOverride('s1', null, active)
      assert.equal(getSessionColorOverride('s1', active), null)
      assert.deepEqual(calls.at(-1), ['setColor', 's1', null])
      assert.equal(storage.backing.size, 0, 'an empty map is removed, not left behind')

      calls.length = 0
      setSessionColorOverride('s2', '#abcdef', otherLocal)
      assert.equal(getSessionColorOverride('s2', otherLocal), '#abcdef')
      assert.equal(getSessionColorOverride('s2', active), null, 'colours do not leak across routes')
      assert.deepEqual(calls, [])
    })
  } finally {
    setPluginStorage(null)
  }
})

test('unread marks are navigator-only: persisted, never sent to host.sessions', async () => {
  const storage = fakeCtxStorage()
  setPluginStorage(storage)
  try {
    await withSessionsSpy(async calls => {
      const route = legacy('default')
      assert.equal(await toggleSessionUnread('s1', false, route), true)
      assert.equal(storage.backing.size, 1)
      assert.equal(await toggleSessionUnread('s1', true, route), false)
      assert.equal(storage.backing.size, 0)
      assert.deepEqual(calls, [])
    })
  } finally {
    setPluginStorage(null)
  }
})

test('pin/colour degrade quietly on a Desktop without host.sessions', async () => {
  setPluginStorage(fakeCtxStorage())
  const prior = host.sessions
  delete host.sessions
  try {
    assert.equal(await toggleSessionPin('s1', false, legacy('default')), true)
    setSessionColorOverride('s1', '#fff', legacy('default'))
    assert.equal(getSessionColorOverride('s1', legacy('default')), '#fff')
  } finally {
    host.sessions = prior
    setPluginStorage(null)
  }
})

test('copyText prefers ctx.os.writeClipboard, falls back to the web clipboard, then reports failure', async () => {
  const touched = installTripwires()
  const priorNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const setNav = value => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
  try {
    const sdkCalls = []
    const webCalls = []
    setNav({ clipboard: { writeText: async t => { webCalls.push(t) } } })

    setPluginContext({ os: { writeClipboard: async t => { sdkCalls.push(t); return true } } })
    assert.equal(await copyText('hello'), true)
    assert.deepEqual([sdkCalls, webCalls], [['hello'], []], 'SDK door used, web clipboard untouched')

    // SDK says unavailable (false) or throws: fall back to navigator.clipboard.
    setPluginContext({ os: { writeClipboard: async () => false } })
    assert.equal(await copyText('a'), true)
    setPluginContext({ os: { writeClipboard: async () => { throw new Error('nope') } } })
    assert.equal(await copyText('b'), true)
    assert.deepEqual(webCalls, ['a', 'b'])

    // Neither door works.
    setNav({})
    setPluginContext({ os: { writeClipboard: async () => false } })
    assert.equal(await copyText('c'), false)
    assert.deepEqual(touched, [], 'the private window.hermesDesktop bridge is never used')
  } finally {
    if (priorNav) Object.defineProperty(globalThis, 'navigator', priorNav)
    else delete globalThis.navigator
    setPluginContext({})
    removeTripwires()
  }
})
