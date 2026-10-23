// Real-backend contract tests.
//
// Everything else in this suite runs the plugin against mocked Desktop objects,
// which can only prove the plugin sends the call it was written to send. These
// tests run the plugin's own functions against the REAL Hermes gateway handlers
// (a throwaway HERMES_HOME seeded with stored sessions), so they fail when the
// backend would reject what the plugin sends, e.g. a stored session id given to a
// call that only accepts a live runtime id.
//
// They need a Hermes checkout with a working Python (see tests/live/gateway.mjs).
// When none is found they SKIP with a reason instead of passing silently.
import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import {
  bulkMutate,
  addToSelection,
  branchSession,
  createSessionInProject,
  fetchProjectList,
  fetchSessionMessages,
  renameSession,
  requestForRoute,
  selectionAtom,
  selectionFor,
  withStoredSession
} from '../desktop-plugin/desktop/plugin.js'
import { host, resetRouteMocks, setRouteMockHandler } from './sdk-stub.mjs'
import { liveBackendAvailable, startGateway } from './live/gateway.mjs'

const route = { connectionId: '__legacy_active__', mode: 'legacy', profile: 'default', targetProfile: 'default' }
const available = liveBackendAvailable()
const skip = available ? false : 'no Hermes checkout with a working Python found (set HERMES_AGENT_DIR / HERMES_AGENT_PYTHON)'
const EMPTY = { active: false, routeKey: '', ids: [] }

let gw
before(async () => {
  if (!available) return
  gw = await startGateway()
})
after(async () => {
  await gw?.stop()
})

let counter = 0
// Seed fresh stored sessions so tests never depend on each other's leftovers.
async function seed(count = 1, extra = {}) {
  const prefix = `t${++counter}-`
  const ids = Array.from({ length: count }, (_, i) => `${prefix}${i}`)
  await gw.seed({ sessions: ids.map(id => ({ id, title: `Title ${id}`, cwd: '/tmp', messages: 4, ...extra })) })
  return ids
}

function useBackend() {
  resetRouteMocks()
  selectionAtom.set(EMPTY)
  setRouteMockHandler((method, params) => gw.call(method, params))
}

const listed = async () => (await gw.call('session.list', { limit: 100 })).sessions
const titleOf = async id => (await listed()).find(s => s.id === id)?.title
const liveKeys = async () => (await gw.call('session.active_list', {})).sessions.map(s => s.session_key)

test('rename persists on a stored session and leaves no live runtime behind', { skip }, async () => {
  useBackend()
  const [id] = await seed()
  await renameSession({ id, title: `Title ${id}` }, route, 'Renamed By Navigator')
  assert.equal(await titleOf(id), 'Renamed By Navigator', 'the new title is really stored')
  assert.deepEqual((await liveKeys()).filter(k => k === id), [], 'the session we resumed was closed again')
})

test('rename works on a session the user already has open, and does not close it', { skip }, async () => {
  useBackend()
  const [id] = await seed()
  const userRuntime = (await gw.call('session.resume', { session_id: id })).session_id // the user opened it

  await renameSession({ id }, route, 'Renamed While Open')

  assert.equal(await titleOf(id), 'Renamed While Open')
  assert.ok((await liveKeys()).includes(id), "the user's open session is still open")
  const history = await gw.call('session.history', { session_id: userRuntime })
  assert.equal(history.messages.length, 4, "and the user's own handle still works")
  await gw.call('session.close', { session_id: userRuntime })
})

test('withStoredSession closes only what it opened, even when the work throws', { skip }, async () => {
  useBackend()
  const [id] = await seed()
  await assert.rejects(() => withStoredSession(route, id, () => { throw new Error('boom') }), /boom/)
  assert.deepEqual((await liveKeys()).filter(k => k === id), [], 'closed after a failure')
})

test('export reads the real transcript of a stored session, and of an open one', { skip }, async () => {
  useBackend()
  const [stored, open] = await seed(2)
  const fromStored = await fetchSessionMessages({ id: stored }, route)
  assert.equal(fromStored.length, 4)
  assert.deepEqual(fromStored.map(m => m.role), ['user', 'assistant', 'user', 'assistant'])
  assert.match(fromStored[0].text, new RegExp(`of ${stored}`))

  const runtime = (await gw.call('session.resume', { session_id: open })).session_id
  assert.equal((await fetchSessionMessages({ id: open }, route)).length, 4)
  assert.ok((await liveKeys()).includes(open), 'exporting an open session leaves it open')
  await gw.call('session.close', { session_id: runtime })
})

test('branch creates a real stored copy with the same transcript and opens it', { skip }, async () => {
  useBackend()
  const [id] = await seed()
  const before = (await listed()).length

  const newId = await branchSession({ id }, route)

  assert.ok(newId && newId !== id, 'a new stored session id came back')
  assert.equal((await listed()).length, before + 1, 'the branch exists in the real list')
  assert.equal(host.lastOpenedSession?.sessionId, newId, 'and the plugin opened that new session')
  assert.equal(host.lastNotification.kind, 'success')
  const copied = await gw.call('session.resume', { session_id: newId })
  assert.equal(copied.message_count, 4)
  await gw.call('session.close', { session_id: copied.session_id })
})

test('bulk archive hides the sessions in the real list and prunes the selection', { skip }, async () => {
  useBackend()
  const ids = await seed(3)
  selectionAtom.set(addToSelection(EMPTY, route, ids))

  const outcome = await bulkMutate('archive', ids, route)

  assert.deepEqual(outcome.done.sort(), [...ids].sort())
  assert.deepEqual(outcome.failed, [])
  const visible = (await listed()).map(s => s.id)
  for (const id of ids) assert.equal(visible.includes(id), false, `${id} is gone from the default list`)
  assert.deepEqual(selectionFor(selectionAtom.get(), route), [])
})

test('bulk delete removes stored sessions; one the user has open is refused and stays selected', { skip }, async () => {
  useBackend()
  const [gone, held] = await seed(2)
  const runtime = (await gw.call('session.resume', { session_id: held })).session_id
  selectionAtom.set(addToSelection(EMPTY, route, [gone, held]))

  const outcome = await bulkMutate('delete', [gone, held], route)

  assert.deepEqual(outcome.done, [gone])
  assert.equal(outcome.failed.length, 1)
  assert.equal(outcome.failed[0].id, held)
  assert.match(String(outcome.failed[0].error.message), /active session/i, "the backend's own reason is reported")
  const ids = (await listed()).map(s => s.id)
  assert.equal(ids.includes(gone), false)
  assert.equal(ids.includes(held), true)
  assert.deepEqual(selectionFor(selectionAtom.get(), route), [held], 'the refused one stays selected for retry')
  await gw.call('session.close', { session_id: runtime })
})

test('bulk move changes the working directory of every selected session', { skip }, async () => {
  useBackend()
  const ids = await seed(2)
  const target = '/var'
  const outcome = await bulkMutate('move', ids, route, { cwd: target })
  assert.deepEqual(outcome.failed, [])
  const tree = await fetchProjectList(route)
  const project = tree.projects.find(p => p.path === target)
  assert.ok(project, 'the target directory now exists as a project')
  assert.ok(project.sessionCount >= 2, 'with the moved sessions in it')
})

test('the Navigator list calls return the shapes the plugin reads', { skip }, async () => {
  useBackend()
  const ids = await seed(2)
  const list = await requestForRoute(route, 'session.list', { limit: 500 })
  assert.ok(ids.every(id => list.sessions.some(s => s.id === id)))
  for (const key of ['id', 'title', 'preview', 'started_at', 'message_count']) {
    assert.ok(key in list.sessions[0], `session rows carry ${key}`)
  }
  const tree = await fetchProjectList(route)
  assert.ok(Array.isArray(tree.projects))
  const project = tree.projects.find(p => p.path === '/tmp')
  const full = await requestForRoute(route, 'projects.project_sessions', { project_id: project.id, session_limit: 2000 })
  const flat = (full.project.repos || []).flatMap(r => (r.groups || []).flatMap(g => g.sessions || []))
  assert.ok(ids.every(id => flat.some(s => s.id === id)), 'project drill-in lists the stored sessions')
})

test('creating a session in a project and in Home works, and the project one lands in that directory', { skip }, async () => {
  useBackend()
  const inProject = await createSessionInProject({ id: 'p', label: 'Var', path: '/var' }, route)
  assert.ok(inProject, 'a stored session id came back')
  assert.equal(host.lastOpenedSession?.sessionId, inProject, 'and it was opened')
  const live = (await gw.call('session.active_list', {})).sessions.find(s => s.session_key === inProject)
  if (live) await gw.call('session.close', { session_id: live.id })

  const home = await createSessionInProject({ id: '__home__', isNoProject: true, label: 'Home' }, route)
  assert.ok(home && home !== inProject, 'Home creates a different session')
  assert.match(host.lastNotification.message, /Started new session in Home/)
})
