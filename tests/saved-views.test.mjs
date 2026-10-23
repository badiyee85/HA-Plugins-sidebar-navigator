import assert from 'node:assert/strict'
import test from 'node:test'
import plugin, {
  NavigatorShell,
  SaveViewDialog,
  SavedViewsBar,
  VIEWS_MAX,
  VIEW_NAME_MAX,
  applyView,
  browseStateAtom,
  deleteView,
  getSavedViews,
  invalidateTagsCache,
  queryAtom,
  sanitizeViews,
  saveView,
  setPluginStorage,
  summarizeSaveView,
  suggestViewName,
  viewAtom,
  viewIsActive
} from '../desktop-plugin/desktop/plugin.js'
import { host, resetRouteMocks } from './sdk-stub.mjs'

const routeA = { connectionId: '__legacy_active__', mode: 'legacy', profile: 'alpha', targetProfile: 'alpha' }
const routeB = { connectionId: '__legacy_active__', mode: 'legacy', profile: 'beta', targetProfile: 'beta' }

function memoryStorage() {
  const backing = new Map()
  return {
    backing,
    get: (key, fallback) => (backing.has(key) ? JSON.parse(backing.get(key)) : fallback),
    set: (key, value) => { backing.set(key, JSON.stringify(value)) },
    remove: key => { backing.delete(key) }
  }
}

function fresh() {
  resetRouteMocks()
  const storage = memoryStorage()
  setPluginStorage(storage)
  queryAtom.set('')
  viewAtom.set('projects')
  browseStateAtom.set({ manual: false, selected: null, unavailable: null })
  return storage
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
const buttons = tree => find(tree, n => n.type === 'button')

test('saveView stores a trimmed, collapsed name and query', () => {
  fresh()
  const result = saveView(routeA, { name: '  Ops   triage  ', query: '  deploy   #ops ', mode: 'sessions' })
  assert.equal(result.ok, true)
  assert.equal(result.replaced, false)
  assert.deepEqual(
    getSavedViews(routeA).map(({ name, query, mode }) => ({ name, query, mode })),
    [{ name: 'Ops triage', query: 'deploy #ops', mode: 'sessions' }]
  )
})

test('names are capped and unknown modes fall back to projects', () => {
  fresh()
  const { view } = saveView(routeA, { name: 'n'.repeat(80), query: 'x', mode: 'weird' })
  assert.equal(view.name.length, VIEW_NAME_MAX)
  assert.equal(view.mode, 'projects')
})

test('empty name or empty query is refused and stores nothing', () => {
  const storage = fresh()
  assert.deepEqual(saveView(routeA, { name: '  ', query: 'x' }), { ok: false, reason: 'name' })
  assert.deepEqual(saveView(routeA, { name: 'ok', query: '   ' }), { ok: false, reason: 'query' })
  assert.deepEqual(saveView({}, { name: 'ok', query: 'x' }), { ok: false, reason: 'unavailable' })
  assert.equal(storage.backing.size, 0)
})

test('saving under an existing name (any case) updates it in place and keeps its id', () => {
  fresh()
  const first = saveView(routeA, { name: 'Bugs', query: '#bug', mode: 'projects' })
  const again = saveView(routeA, { name: 'bUGS', query: '#bug #urgent', mode: 'sessions' })
  assert.equal(again.replaced, true)
  assert.equal(again.view.id, first.view.id)
  const all = getSavedViews(routeA)
  assert.equal(all.length, 1)
  assert.deepEqual([all[0].name, all[0].query, all[0].mode], ['bUGS', '#bug #urgent', 'sessions'])
})

test('the view limit refuses new names but still allows updating an existing one', () => {
  fresh()
  for (let i = 0; i < VIEWS_MAX; i += 1) assert.equal(saveView(routeA, { name: `v${i}`, query: `q${i}` }).ok, true)
  assert.deepEqual(saveView(routeA, { name: 'one-too-many', query: 'x' }), { ok: false, reason: 'limit' })
  assert.equal(saveView(routeA, { name: 'v3', query: 'changed' }).ok, true)
  assert.equal(getSavedViews(routeA).length, VIEWS_MAX)
  assert.equal(getSavedViews(routeA).find(v => v.name === 'v3').query, 'changed')
})

test('views are scoped per profile route', () => {
  fresh()
  saveView(routeA, { name: 'Mine', query: '#a' })
  assert.deepEqual(getSavedViews(routeB), [])
  saveView(routeB, { name: 'Theirs', query: '#b' })
  assert.deepEqual(getSavedViews(routeA).map(v => v.name), ['Mine'])
  assert.deepEqual(getSavedViews(routeB).map(v => v.name), ['Theirs'])
})

test('deleteView removes only that view and clears storage when none remain', () => {
  const storage = fresh()
  const a = saveView(routeA, { name: 'A', query: 'a' }).view
  const b = saveView(routeA, { name: 'B', query: 'b' }).view
  assert.equal(deleteView(routeA, a.id), true)
  assert.deepEqual(getSavedViews(routeA).map(v => v.id), [b.id])
  assert.equal(deleteView(routeA, 'nope'), false)
  assert.equal(deleteView(routeB, b.id), false, 'another profile cannot delete it')
  assert.equal(deleteView(routeA, b.id), true)
  assert.equal(storage.backing.size, 0, 'no empty list left behind')
})

test('corrupt stored data is sanitised, never thrown on', () => {
  const storage = fresh()
  const { view } = saveView(routeA, { name: 'seed', query: 'x' })
  const [key] = [...storage.backing.keys()]
  storage.backing.set(key, JSON.stringify([
    null, 'junk', 7, { name: 'no id', query: 'x' }, { id: 'a', name: '', query: 'x' }, { id: 'b', name: 'noquery', query: '  ' },
    { id: 'c', name: 'Good', query: ' #t  q ', mode: 'sessions' },
    { id: 'd', name: 'good', query: 'dupe name' }
  ]))
  invalidateTagsCache()
  assert.deepEqual(getSavedViews(routeA).map(v => [v.id, v.name, v.query, v.mode]), [['c', 'Good', '#t q', 'sessions']])
  assert.deepEqual(sanitizeViews('not a list'), [])
  assert.ok(view.id)
  storage.backing.set(key, '{"not":"array"}')
  invalidateTagsCache()
  assert.deepEqual(getSavedViews(routeA), [])
})

test('applyView sets both the filter and the mode', () => {
  fresh()
  const { view } = saveView(routeA, { name: 'Recent ops', query: 'deploy #ops', mode: 'sessions' })
  applyView(view)
  assert.equal(queryAtom.get(), 'deploy #ops')
  assert.equal(viewAtom.get(), 'sessions')
})

test('viewIsActive needs the same query (ignoring case/spacing) AND the same mode', () => {
  const view = { query: 'deploy #ops', mode: 'sessions' }
  assert.equal(viewIsActive(view, '  Deploy   #OPS ', 'sessions'), true)
  assert.equal(viewIsActive(view, 'deploy #ops', 'projects'), false)
  assert.equal(viewIsActive(view, 'deploy', 'sessions'), false)
})

test('suggestViewName turns a query into a readable default', () => {
  assert.equal(suggestViewName('#bug   #urgent'), 'bug urgent')
  assert.equal(suggestViewName(''), '')
  assert.ok(suggestViewName('x'.repeat(90)).length <= VIEW_NAME_MAX)
})

test('summarizeSaveView explains each outcome', () => {
  const ok = summarizeSaveView({ ok: true, replaced: false, view: { name: 'A' } })
  assert.equal(ok.kind, 'success')
  assert.match(ok.message, /Saved view/)
  assert.match(summarizeSaveView({ ok: true, replaced: true, view: { name: 'A' } }).message, /Updated view/)
  for (const reason of ['name', 'query', 'limit', 'unavailable']) {
    const out = summarizeSaveView({ ok: false, reason })
    assert.equal(out.kind, 'error')
    assert.ok(out.message.length > 5)
  }
})

test('SavedViewsBar is hidden when there is nothing to show', () => {
  fresh()
  assert.equal(SavedViewsBar({ route: routeA }), null)
  assert.equal(SavedViewsBar({ route: null }), null)
})

test('SavedViewsBar offers Save only for an unsaved, non-empty filter', () => {
  fresh()
  queryAtom.set('#bug')
  const unsaved = SavedViewsBar({ route: routeA })
  assert.ok(buttons(unsaved).some(b => b.props.title === 'Save the current filter as a view'))

  saveView(routeA, { name: 'Bugs', query: '#bug', mode: 'projects' })
  const saved = SavedViewsBar({ route: routeA })
  assert.equal(buttons(saved).some(b => b.props.title === 'Save the current filter as a view'), false, 'already saved: no duplicate offer')

  viewAtom.set('sessions') // same text, other mode counts as a different view
  const otherMode = SavedViewsBar({ route: routeA })
  assert.ok(buttons(otherMode).some(b => b.props.title === 'Save the current filter as a view'))
})

test('SavedViewsBar chips apply their view, mark the active one, and delete on ×', () => {
  fresh()
  const a = saveView(routeA, { name: 'Ops', query: 'deploy #ops', mode: 'sessions' }).view
  saveView(routeA, { name: 'Bugs', query: '#bug', mode: 'projects' })

  let bar = SavedViewsBar({ route: routeA })
  const chip = name => buttons(bar).find(b => b.props.children === name)
  assert.equal(chip('Ops').props['aria-pressed'], false)

  chip('Ops').props.onClick()
  assert.equal(queryAtom.get(), 'deploy #ops')
  assert.equal(viewAtom.get(), 'sessions')

  bar = SavedViewsBar({ route: routeA })
  assert.equal(chip('Ops').props['aria-pressed'], true)
  assert.equal(chip('Bugs').props['aria-pressed'], false)

  buttons(bar).find(b => b.props['aria-label'] === 'Delete view Ops').props.onClick()
  assert.deepEqual(getSavedViews(routeA).map(v => v.name), ['Bugs'])
  assert.match(host.lastNotification.message, /Deleted view/)
  assert.ok(a.id)
})

test('SaveViewDialog saves with its suggested name and reports the outcome', () => {
  fresh()
  let closed = null
  const dialog = SaveViewDialog({ open: true, onOpenChange: v => { closed = v }, route: routeA, query: '#bug #urgent', mode: 'sessions' })
  const save = find(dialog, n => n.props?.children === 'Save')[0]
  assert.equal(save.props.disabled, false)
  save.props.onClick()
  assert.deepEqual(getSavedViews(routeA).map(v => [v.name, v.query, v.mode]), [['bug urgent', '#bug #urgent', 'sessions']])
  assert.equal(host.lastNotification.kind, 'success')
  assert.equal(closed, false, 'dialog closes after a successful save')
})

test('SaveViewDialog stays open and says why when the save is refused', () => {
  fresh()
  for (let i = 0; i < VIEWS_MAX; i += 1) saveView(routeA, { name: `v${i}`, query: `q${i}` })
  let closed = null
  const dialog = SaveViewDialog({ open: true, onOpenChange: v => { closed = v }, route: routeA, query: 'brand new', mode: 'projects' })
  find(dialog, n => n.props?.children === 'Save')[0].props.onClick()
  assert.equal(closed, null, 'not closed')
  assert.equal(host.lastNotification.kind, 'error')
  assert.match(host.lastNotification.message, /up to 20 views/)
})

test('Enter in the name field saves; the dialog mounts only when the bar opens it', () => {
  fresh()
  const dialog = SaveViewDialog({ open: true, onOpenChange() {}, route: routeA, query: 'enter me', mode: 'projects' })
  const input = find(dialog, n => n.type === 'Input')[0]
  let prevented = false
  input.props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true }, nativeEvent: {} })
  assert.equal(prevented, true)
  assert.equal(getSavedViews(routeA).length, 1)

  queryAtom.set('something')
  const bar = SavedViewsBar({ route: routeA })
  assert.equal(find(bar, n => n.type === SaveViewDialog).length, 0, 'idle bar mounts no dialog')
})

test('the Navigator shell shows the Views bar for the selected profile (production wiring)', () => {
  fresh()
  saveView(routeA, { name: 'Bugs', query: '#bug' })
  browseStateAtom.set({ manual: true, selected: routeA, unavailable: null })
  const shell = NavigatorShell({})
  const bars = find(shell, n => n.type === SavedViewsBar)
  assert.equal(bars.length, 1)
  assert.deepEqual(bars[0].props.route, routeA)
  // and it really is the plugin's registered page that renders this shell
  const registered = []
  plugin.register({ storage: memoryStorage(), os: {}, register: c => registered.push(c) })
  assert.ok(registered.find(c => c.id === 'navigator-page'))
})
