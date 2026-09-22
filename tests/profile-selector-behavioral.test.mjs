import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeRoutes,
  reconcileBrowseState,
  queryKey,
  routeKey
} from '../desktop-plugin/desktop/plugin.js'

test('Sidebar Navigator profile behavior', () => {
  const local = { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' }
  const remote = { connectionId: 'remote', mode: 'remote', profile: 'default', targetProfile: 'default' }

  assert.equal(normalizeRoutes([local, remote]).length, 2)
  assert.notDeepEqual(
    queryKey('project-sessions', local, ['same-project']),
    queryKey('project-sessions', remote, ['same-project'])
  )
  assert.notEqual(routeKey(local), routeKey(remote))
  assert.deepEqual(
    reconcileBrowseState({ manual: true, selected: remote }, [local, remote], 'local', 'default').selected,
    remote
  )
})
