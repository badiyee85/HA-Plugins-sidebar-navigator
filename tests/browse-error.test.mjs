import test from 'node:test'
import assert from 'node:assert/strict'
import { describeBrowseError } from '../desktop-plugin/desktop/plugin.js'

const tabby = { connectionId: 'local', mode: 'local', profile: 'tabby', targetProfile: 'tabby' }

test('browse errors name the profile and surface the backend reason', async t => {
  await t.test('keeps the actionable backend message instead of a generic one', () => {
    const msg = describeBrowseError(
      new Error("Session store schema is unavailable or corrupt. Start or restart this profile's gateway to reconcile it."),
      tabby,
      'projects'
    )
    assert.match(msg, /tabby/)
    assert.match(msg, /Session store schema is unavailable/)
    assert.match(msg, /projects/i)
  })

  await t.test('accepts plain string and {message}/{detail} shaped rejections', () => {
    assert.match(describeBrowseError('boom', tabby, 'sessions'), /boom/)
    assert.match(describeBrowseError({ detail: 'store busy' }, tabby, 'sessions'), /store busy/)
    assert.match(describeBrowseError({ message: 'offline' }, tabby, 'sessions'), /offline/)
  })

  await t.test('falls back to a generic line when no reason is available', () => {
    for (const bad of [undefined, null, {}, new Error('   ')]) {
      const msg = describeBrowseError(bad, tabby, 'projects')
      assert.match(msg, /tabby/)
      assert.ok(msg.length > 10)
    }
  })

  await t.test('long reasons are truncated so the sidebar stays readable', () => {
    const msg = describeBrowseError(new Error('x'.repeat(2000)), tabby, 'projects')
    assert.ok(msg.length < 400, `length ${msg.length}`)
  })

  await t.test('works without a route', () => {
    assert.match(describeBrowseError(new Error('nope'), null, 'projects'), /nope/)
  })
})
