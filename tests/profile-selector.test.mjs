import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRoutes, queryKey, routeKey } from '../desktop-plugin/desktop/plugin.js'

test('Sidebar Navigator profile contract', () => {
  const local = { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' }
  const remote = { connectionId: 'remote', mode: 'remote', profile: 'default', targetProfile: 'default' }
  assert.equal(normalizeRoutes([local, remote]).length, 2)
  assert.notEqual(routeKey(local), routeKey(remote))
  assert.notDeepEqual(queryKey('project-sessions', local, ['same']), queryKey('project-sessions', remote, ['same']))
})
