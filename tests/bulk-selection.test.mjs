import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BULK_ACTIONS,
  BulkBar,
  SelectBox,
  SessionRow,
  bulkMutate,
  focusAtom,
  bulkTag,
  addToSelection,
  partitionBusy,
  removeFromSelection,
  runBulk,
  selectionAtom,
  selectionFor,
  summarizeBulk,
  summarizeTag,
  toggleSelection
} from '../desktop-plugin/desktop/plugin.js'
import { host, resetRouteMocks, setRouteMockHandler } from './sdk-stub.mjs'

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  }
}

const legacy = (profile = 'default') => ({
  connectionId: '__legacy_active__',
  mode: 'legacy',
  profile,
  targetProfile: profile
})
const remote = {
  connectionId: 'vds',
  mode: 'remote',
  profile: 'worker',
  targetProfile: 'worker'
}
const EMPTY = { active: false, routeKey: '', ids: [] }

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids : [kids]) walk(kid, visit)
}
function find(node, predicate) {
  const hits = []
  walk(node, n => predicate(n) && hits.push(n))
  return hits
}

const settle = () => new Promise(resolve => setTimeout(resolve, 25))

function reset() {
  resetRouteMocks()
  selectionAtom.set(EMPTY)
  host.state.busyBySession.set({})
}

test('selection reducers keep ids scoped to one route', () => {
  const a = legacy('default')
  const b = legacy('other')
  let state = toggleSelection(EMPTY, a, 's1')
  state = toggleSelection(state, a, 's2')
  assert.deepEqual(selectionFor(state, a), ['s1', 's2'])
  assert.deepEqual(selectionFor(state, b), [], 'another route sees nothing')

  // Picking under a different route starts a fresh selection instead of mixing.
  const switched = toggleSelection(state, b, 's9')
  assert.deepEqual(selectionFor(switched, b), ['s9'])
  assert.deepEqual(selectionFor(switched, a), [])

  assert.deepEqual(selectionFor(toggleSelection(state, a, 's1'), a), ['s2'], 'toggle off removes')
})

test('addToSelection is a de-duplicating union and removeFromSelection subtracts', () => {
  const route = legacy()
  let state = addToSelection(EMPTY, route, ['a', 'b', 'a', '', null])
  assert.deepEqual(selectionFor(state, route), ['a', 'b'])
  state = addToSelection(state, route, ['b', 'c'])
  assert.deepEqual(selectionFor(state, route), ['a', 'b', 'c'])
  state = removeFromSelection(state, route, ['a', 'c'])
  assert.deepEqual(selectionFor(state, route), ['b'])
  assert.equal(state.active, true, 'removal does not leave select mode')
})

test('runBulk continues past a failing item and reports each outcome', async () => {
  const seen = []
  const result = await runBulk(['a', 'b', 'c'], async id => {
    seen.push(id)
    if (id === 'b') throw new Error('boom')
  })
  assert.deepEqual(seen, ['a', 'b', 'c'])
  assert.deepEqual(result.done, ['a', 'c'])
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].id, 'b')
  assert.equal(result.failed[0].error.message, 'boom')
})

test('partitionBusy skips running sessions on local routes only', () => {
  reset()
  host.state.busyBySession.set({ s2: true })
  assert.deepEqual(partitionBusy(['s1', 's2', 's3'], legacy()), { runnable: ['s1', 's3'], skipped: ['s2'] })
  // Busy state is only observable for the local profile; remote ids pass through.
  assert.deepEqual(partitionBusy(['s1', 's2'], remote), { runnable: ['s1', 's2'], skipped: [] })
})

test('bulkMutate archive sends one request per session and prunes the selection', async () => {
  reset()
  const route = legacy()
  const calls = []
  setRouteMockHandler((method, params) => {
    calls.push([method, params])
    return {}
  })
  selectionAtom.set(addToSelection(EMPTY, route, ['s1', 's2', 's3']))

  const outcome = await bulkMutate('archive', ['s1', 's2', 's3'], route)

  assert.deepEqual(calls, ['s1', 's2', 's3'].map(id => ['session.set_hidden', { session_id: id, hidden: true }]))
  assert.deepEqual(outcome.done, ['s1', 's2', 's3'])
  assert.deepEqual(selectionFor(selectionAtom.get(), route), [], 'completed ids leave the selection')
  assert.equal(host.lastNotification.kind, 'success')
  assert.match(host.lastNotification.message, /Archived 3 sessions/)
})

test('bulkMutate keeps failed and skipped sessions selected so they can be retried', async () => {
  reset()
  const route = legacy()
  host.state.busyBySession.set({ running: true })
  const calls = []
  setRouteMockHandler((method, params) => {
    calls.push(params.session_id)
    if (params.session_id === 'bad') throw new Error('backend refused')
    return {}
  })
  selectionAtom.set(addToSelection(EMPTY, route, ['ok', 'bad', 'running']))

  const outcome = await bulkMutate('delete', ['ok', 'bad', 'running'], route)

  assert.deepEqual(calls, ['ok', 'bad'], 'a running session is never sent to the backend')
  assert.deepEqual(outcome.done, ['ok'])
  assert.deepEqual(outcome.skipped, ['running'])
  assert.deepEqual(selectionFor(selectionAtom.get(), route).sort(), ['bad', 'running'])
  assert.equal(host.lastNotification.kind, 'error')
  assert.match(host.lastNotification.message, /Deleted 1 session/)
  assert.match(host.lastNotification.message, /1 failed \(backend refused\)/)
  assert.match(host.lastNotification.message, /1 skipped \(running\)/)
})

test('bulkMutate move targets the project directory for every session', async () => {
  reset()
  const route = legacy()
  const calls = []
  setRouteMockHandler((method, params) => {
    calls.push([method, params])
    return {}
  })
  await bulkMutate('move', ['a', 'b'], route, { cwd: '/work/proj' })
  assert.deepEqual(calls, [
    ['session.workspace.move', { session_key: 'a', cwd: '/work/proj' }],
    ['session.workspace.move', { session_key: 'b', cwd: '/work/proj' }]
  ])
})

test('deleting the focused session navigates away; deleting others does not', async () => {
  reset()
  const route = legacy()
  setRouteMockHandler(() => ({}))
  // Legacy routes match a focused owner that has no connection id.
  const priorOwner = host.state.focusedSessionOwner.get()
  host.state.focusedSessionOwner.set({ connectionId: '', profile: 'default' })
  try {
    focusAtom.set('other')
    await bulkMutate('delete', ['a'], route)
    assert.equal(host.lastNavigated, undefined)

    focusAtom.set('a')
    await bulkMutate('delete', ['a'], route)
    assert.equal(host.lastNavigated, '/')
  } finally {
    focusAtom.set('')
    host.state.focusedSessionOwner.set(priorOwner)
  }
})

test('bulkMutate rejects an unknown action without touching the backend', async () => {
  reset()
  let hit = false
  setRouteMockHandler(() => { hit = true; return {} })
  await assert.rejects(() => bulkMutate('explode', ['a'], legacy()), /Unknown bulk action/)
  assert.equal(hit, false)
  assert.deepEqual(Object.keys(BULK_ACTIONS).sort(), ['archive', 'delete', 'move'])
})

test('bulkTag adds and removes in one pass and respects the per-session cap', () => {
  const route = { connectionId: 'local', mode: 'local', profile: 'bulk-tags', targetProfile: 'bulk-tags' }
  const full = Array.from({ length: 16 }, (_, i) => `t${i}`)
  // Seed: s1 already tagged, sfull at the cap, s2 empty.
  bulkTag(['s1'], route, 'bug', 'add')
  for (const t of full) bulkTag(['sfull'], route, t, 'add')

  const added = bulkTag(['s1', 's2', 'sfull'], route, 'Bug', 'add')
  assert.deepEqual(added, { changed: 1, unchanged: 1, full: 1 })
  assert.match(summarizeTag('Bug', 'add', added).message, /Tagged 1 session #bug · 1 unchanged · 1 at the 16-tag limit/)

  const removed = bulkTag(['s1', 's2', 'nope'], route, 'bug', 'remove')
  assert.deepEqual(removed, { changed: 2, unchanged: 1, full: 0 })
  assert.deepEqual(bulkTag(['s1'], route, '', 'add'), { changed: 0, unchanged: 0, full: 0 })
})

test('summarizeBulk reports kind by outcome', () => {
  assert.equal(summarizeBulk('Archived', { done: ['a'] }).kind, 'success')
  assert.equal(summarizeBulk('Archived', { done: ['a'], failed: [{ id: 'b', error: new Error('x') }] }).kind, 'error')
  assert.equal(summarizeBulk('Archived', { skipped: ['r'] }).kind, 'info')
  assert.equal(summarizeBulk('Archived', {}).message, 'No sessions selected')
})

test('BulkBar disables actions until something is selected and shows the count', () => {
  reset()
  const route = legacy()
  const buttons = tree => find(tree, n => n.type === 'button')

  const empty = BulkBar({ route })
  assert.ok(find(empty, n => n.props?.role === 'toolbar').length === 1)
  const actionTitles = ['Add or remove a tag', 'Move the selected', 'Archive the selected', 'Delete the selected']
  for (const title of actionTitles) {
    const [btn] = buttons(empty).filter(b => b.props.title?.startsWith(title))
    assert.ok(btn, `${title} button present`)
    assert.equal(btn.props.disabled, true, `${title} disabled with nothing selected`)
  }

  selectionAtom.set(addToSelection(EMPTY, route, ['s1', 's2']))
  const some = BulkBar({ route })
  for (const title of actionTitles) {
    const [btn] = buttons(some).filter(b => b.props.title?.startsWith(title))
    assert.equal(btn.props.disabled, false, `${title} enabled with a selection`)
  }
  assert.ok(find(some, n => n.props?.children === '2 selected').length === 1)
})

test('BulkBar buttons reach the backend through the production path', async () => {
  reset()
  const route = legacy()
  const calls = []
  setRouteMockHandler((method, params) => {
    calls.push([method, params.session_id])
    return {}
  })
  selectionAtom.set(addToSelection(EMPTY, route, ['s1', 's2']))
  const bar = BulkBar({ route })

  const archive = find(bar, n => n.type === 'button' && n.props.title?.startsWith('Archive'))[0]
  archive.props.onClick() // fire-and-forget in the UI, so wait for the batch to settle
  await settle()
  assert.deepEqual(calls, [['session.set_hidden', 's1'], ['session.set_hidden', 's2']])
  assert.deepEqual(selectionFor(selectionAtom.get(), route), [])

  // Delete is only reachable through the confirm dialog's onConfirm.
  selectionAtom.set(addToSelection(EMPTY, route, ['s3']))
  calls.length = 0
  const confirm = find(BulkBar({ route }), n => n.props?.destructive === true)[0]
  assert.equal(calls.length, 0, 'opening the dialog alone deletes nothing')
  await confirm.props.onConfirm()
  assert.deepEqual(calls, [['session.delete', 's3']])
})

test('SessionRow shows a checkbox and toggles instead of opening while in select mode', () => {
  reset()
  const route = legacy()
  const session = { id: 's1', title: 'Hello', started_at: 1, message_count: 1 }
  const rowOf = () => find(SessionRow({ session, focused: false, allProjects: [], route }), n => n.type === 'button' && n.props.title === 'Hello')[0]

  assert.equal(find(rowOf(), n => n.type === SelectBox).length, 0, 'no checkbox outside select mode')

  selectionAtom.set(addToSelection({ active: true, routeKey: '', ids: [] }, route, []))
  const row = rowOf()
  assert.equal(find(row, n => n.type === SelectBox).length, 1)
  assert.equal(row.props['aria-pressed'], false)

  row.props.onClick()
  assert.deepEqual(selectionFor(selectionAtom.get(), route), ['s1'])
  assert.equal(host.lastOpenedSession, undefined, 'row click selected rather than opened')
})
