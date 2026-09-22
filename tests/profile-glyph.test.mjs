import test from 'node:test'
import assert from 'node:assert/strict'
import {
  profileColor,
  profileColorSoft,
  resolveSessionProfile,
  shouldShowProfileBadge,
  ProfileGlyph
} from '../desktop-plugin/desktop/plugin.js'

test('Profile badge and color derivation contracts', async (t) => {
  await t.test('profileColor produces deterministic HSL color for named profiles', () => {
    // tabby: hashString('tabby') % 360 === 140 -> hsl(140 68% 58%)
    assert.equal(profileColor('tabby'), 'hsl(140 68% 58%)')
    // default and empty return null
    assert.equal(profileColor('default'), null)
    assert.equal(profileColor(''), null)
    assert.equal(profileColor(null), null)
  })

  await t.test('profileColorSoft creates expected color-mix string', () => {
    const color = 'hsl(140 68% 58%)'
    assert.equal(profileColorSoft(color, 22), 'color-mix(in srgb, hsl(140 68% 58%) 22%, transparent)')
  })

  await t.test('resolveSessionProfile resolves hierarchy: session.profile > route.profile > default', () => {
    assert.equal(resolveSessionProfile({ profile: 'tabby' }, { profile: 'clover' }), 'tabby')
    assert.equal(resolveSessionProfile({}, { profile: 'clover' }), 'clover')
    assert.equal(resolveSessionProfile({}, {}), 'default')
    assert.equal(resolveSessionProfile(null, null), 'default')
  })

  await t.test('shouldShowProfileBadge hides badge when profile is default', () => {
    assert.equal(shouldShowProfileBadge('default'), false)
    assert.equal(shouldShowProfileBadge('Default'), false)
    assert.equal(shouldShowProfileBadge(''), false)
    assert.equal(shouldShowProfileBadge(null), false)
    assert.equal(shouldShowProfileBadge('tabby'), true)
    assert.equal(shouldShowProfileBadge('clover'), true)
  })

  await t.test('ProfileGlyph renders initial uppercase letter with role and labels', () => {
    const glyph = ProfileGlyph({ name: 'tabby' })
    assert.ok(glyph)
    assert.equal(glyph.props.role, 'img')
    assert.equal(glyph.props['aria-label'], 'Owned by profile tabby')
    assert.equal(glyph.props.title, 'Owned by profile tabby')
    assert.equal(glyph.props.children, 'T')
    assert.ok(glyph.props.style.backgroundColor.includes('hsl(140 68% 58%)'))
    assert.equal(glyph.props.style.color, 'hsl(140 68% 58%)')
  })

  await t.test('ProfileGlyph returns null for default profile', () => {
    const glyph = ProfileGlyph({ name: 'default' })
    assert.equal(glyph, null)
  })
})
