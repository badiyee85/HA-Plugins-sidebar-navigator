import assert from 'node:assert/strict'
import test from 'node:test'
import plugin, {
  NavigatorShell,
  ProjectBrowser,
  ROW_PAGE_SIZE,
  SessionBrowser,
  SessionRow,
  ShowMoreButton,
  TagDialog,
  addSessionTag,
  closeNavigatorPage,
  fetchProjectList,
  getSessionTags,
  invalidateTagsCache,
  readSessionTagsMap,
  setPluginStorage,
  tagsMapFor,
  writeSessionTagsMap
} from '../desktop-plugin/desktop/plugin.js'
import { host, resetRouteMocks, setQueryMock, setRouteMockHandler } from './sdk-stub.mjs'

const route = { connectionId: '__legacy_active__', mode: 'legacy', profile: 'default', targetProfile: 'default' }

// ctx.storage double that counts reads, so tests can assert HOW OFTEN the plugin
// touches storage, which is what made the Timeline slow.
function countingStorage() {
  const backing = new Map()
  const stats = { gets: 0 }
  return {
    backing,
    stats,
    get: (key, fallback) => { stats.gets += 1; return backing.has(key) ? JSON.parse(backing.get(key)) : fallback },
    set: (key, value) => { backing.set(key, JSON.stringify(value)) },
    remove: key => { backing.delete(key) }
  }
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids : [kids]) walk(kid, visit)
}
const find = (node, predicate) => {
  const hits = []
  walk(node, n => predicate(n) && hits.push(n))
  return hits
}

const manySessions = count =>
  Array.from({ length: count }, (_, i) => ({ id: `s${i}`, title: `Session ${i}`, started_at: 1e9 + i, message_count: 2 }))

test('storage reads do not grow with the number of rows', () => {
  const storage = countingStorage()
  setPluginStorage(storage)
  const seeded = {}
  for (let i = 0; i < 300; i += 1) seeded[`s${i}`] = ['bug', `t${i % 7}`]
  writeSessionTagsMap(route, seeded)

  const readsFor = rowCount => {
    invalidateTagsCache() // as if the page just loaded
    storage.stats.gets = 0
    for (const s of manySessions(rowCount)) SessionRow({ session: s, focused: false, allProjects: [], route })
    return storage.stats.gets
  }
  const few = readsFor(20)
  const many = readsFor(500)
  assert.equal(many, few, `reads are per key, not per row (20 rows: ${few}, 500 rows: ${many})`)
  assert.ok(many < 10)
  setPluginStorage(null)
})

test('the tags cache stays coherent with writes and picks up external changes on invalidation', () => {
  const storage = countingStorage()
  setPluginStorage(storage)
  addSessionTag('s1', 'alpha', route)
  assert.deepEqual(getSessionTags('s1', route), ['alpha'], 'a write is visible immediately')
  addSessionTag('s1', 'beta', route)
  assert.deepEqual(getSessionTags('s1', route), ['alpha', 'beta'])

  // Another window rewrote the stored value behind our back.
  const [key] = [...storage.backing.keys()]
  storage.backing.set(key, JSON.stringify({ s1: ['external'] }))
  assert.deepEqual(getSessionTags('s1', route), ['alpha', 'beta'], 'cached until told otherwise')
  invalidateTagsCache()
  assert.deepEqual(getSessionTags('s1', route), ['external'])
  setPluginStorage(null)
})

test('editing the map returned by readSessionTagsMap never corrupts the cache', () => {
  setPluginStorage(countingStorage())
  addSessionTag('s1', 'keep', route)
  const copy = readSessionTagsMap(route)
  copy.s1 = ['mutated']
  copy.s2 = ['intruder']
  assert.deepEqual(getSessionTags('s1', route), ['keep'])
  assert.deepEqual(getSessionTags('s2', route), [])
  assert.deepEqual(tagsMapFor(route), { s1: ['keep'] })
  setPluginStorage(null)
})

test("another window's storage event refreshes the tags; unrelated keys do not", () => {
  const storage = countingStorage()
  const listeners = []
  globalThis.window = {}
  try {
    plugin.register({
      storage,
      os: {},
      register: () => {},
      addEventListener: (target, type, handler) => { listeners.push({ target, type, handler }); return () => {} }
    })
    const storageListener = listeners.find(l => l.type === 'storage')
    assert.ok(storageListener, 'register() listens for storage events through ctx.addEventListener')

    addSessionTag('s1', 'mine', route)
    const [key] = [...storage.backing.keys()]
    storage.backing.set(key, JSON.stringify({ s1: ['theirs'] }))

    storageListener.handler({ key: 'hermes.desktop.somethingElse' })
    assert.deepEqual(getSessionTags('s1', route), ['mine'], 'an unrelated key leaves the cache alone')

    storageListener.handler({ key: `hermes.plugin.ha-sidebar-navigator.${key}` })
    assert.deepEqual(getSessionTags('s1', route), ['theirs'])
  } finally {
    delete globalThis.window
    setPluginStorage(null)
  }
})

test('idle rows mount no dialogs and a closed TagDialog does no storage work', () => {
  const storage = countingStorage()
  setPluginStorage(storage)
  const row = SessionRow({ session: manySessions(1)[0], focused: false, allProjects: [], route })
  const dialogish = find(row, n => n.type === TagDialog || n.type === 'ConfirmDialog' || n.type === 'Dialog')
  assert.equal(dialogish.length, 0, 'rename / delete / tag dialogs mount only when opened')

  invalidateTagsCache()
  storage.stats.gets = 0
  TagDialog({ open: false, onOpenChange() {}, session: { id: 's1' }, route })
  assert.equal(storage.stats.gets, 0)
  setPluginStorage(null)
})

test('ShowMoreButton appears only when rows are hidden and reveals one page at a time', () => {
  assert.equal(ShowMoreButton({ total: 40, shown: 100, onMore() {} }), null)
  assert.equal(ShowMoreButton({ total: 100, shown: 100, onMore() {} }), null)

  let clicked = 0
  const mid = ShowMoreButton({ total: 150, shown: 100, onMore: () => { clicked += 1 } })
  assert.match(mid.props.children, /Show 50 more \(50 hidden\)/)
  mid.props.onClick()
  assert.equal(clicked, 1)

  const big = ShowMoreButton({ total: 500, shown: 100, onMore() {} })
  assert.match(big.props.children, new RegExp(`Show ${ROW_PAGE_SIZE} more \\(400 hidden\\)`))
})

test('Timeline mounts one page of rows, not every session', () => {
  resetRouteMocks()
  const sessions = manySessions(250)
  setQueryMock(options => (
    options.queryKey.includes('sessions')
      ? { status: 'success', data: { sessions } }
      : { status: 'success', data: { projects: [] } }
  ))
  try {
    const tree = SessionBrowser({ route })
    const rows = find(tree, n => n.type === SessionRow)
    assert.equal(rows.length, ROW_PAGE_SIZE)
    const more = find(tree, n => n.type === ShowMoreButton)[0]
    assert.equal(more.props.total, 250)
    assert.equal(more.props.shown, ROW_PAGE_SIZE)
  } finally {
    setQueryMock(null)
  }
})

test('the Timeline asks for a light project list that cannot collide with the Projects view cache', async () => {
  resetRouteMocks()
  const seen = []
  setQueryMock(options => {
    seen.push(options)
    return { status: 'success', data: { sessions: [], projects: [] } }
  })
  const calls = []
  setRouteMockHandler((method, params) => { calls.push([method, params]); return { projects: [] } })
  try {
    SessionBrowser({ route })
    ProjectBrowser({ route })
    const listQuery = seen.find(o => o.queryKey.includes('projects-list'))
    const treeQuery = seen.find(o => o.queryKey.includes('projects-tree'))
    assert.ok(listQuery, 'Timeline uses its own projects-list entry')
    assert.ok(treeQuery, 'Projects view keeps its projects-tree entry')
    assert.notDeepEqual(listQuery.queryKey, treeQuery.queryKey)

    await listQuery.queryFn()
    await treeQuery.queryFn()
    const [listCall, treeCall] = calls
    assert.equal(listCall[0], 'projects.tree')
    assert.ok(listCall[1].preview_limit < treeCall[1].preview_limit, 'the list skips the heavy session previews')
    await fetchProjectList(route)
    assert.equal(calls.at(-1)[1].preview_limit, listCall[1].preview_limit)
  } finally {
    setQueryMock(null)
  }
})

test('the full-page Navigator has a close button; the docked pane (which has app chrome) does not add one', () => {
  const closable = find(NavigatorShell({ onClose() {} }), n => n.props?.['aria-label'] === 'Close Navigator')
  assert.equal(closable.length, 1)
  assert.equal(find(NavigatorShell({}), n => n.props?.['aria-label'] === 'Close Navigator').length, 0)

  const registered = []
  plugin.register({ storage: null, os: {}, register: c => registered.push(c) })
  const page = registered.find(c => c.id === 'navigator-page')
  const pane = registered.find(c => c.id === 'navigator-pane')
  assert.equal(page.render().props.onClose, closeNavigatorPage, 'route page wires the close action')
  assert.equal(pane.render().props.onClose, undefined)
})

test('closing goes back when there is history, otherwise home', () => {
  resetRouteMocks()
  let backs = 0
  globalThis.window = { history: { length: 3, back: () => { backs += 1 } } }
  try {
    closeNavigatorPage()
    assert.equal(backs, 1)
    assert.equal(host.lastNavigated, undefined)

    globalThis.window.history.length = 1
    closeNavigatorPage()
    assert.equal(backs, 1)
    assert.equal(host.lastNavigated, '/')
  } finally {
    delete globalThis.window
  }
})
