import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SessionStatusDot,
  host
} from './sdk-stub.mjs'

test('Session status and live arc rendering contracts', async (t) => {
  await t.test('SessionStatusDot is exported and renderable', () => {
    assert.equal(typeof SessionStatusDot, 'function')
    const element = SessionStatusDot({
      storedSessionId: 'session-123',
      session: { id: 'session-123', title: 'Test Session' }
    })
    assert.equal(element.type, 'SessionStatusDot')
    assert.equal(element.props.storedSessionId, 'session-123')
  })

  await t.test('busyBySession tracks active background and foreground work', () => {
    assert.ok(host.state.busyBySession)
    host.state.busyBySession.set({ 'session-123': true, 'session-456': false })
    const map = host.state.busyBySession.get()
    assert.equal(map['session-123'], true)
    assert.equal(map['session-456'], false)
  })
})
