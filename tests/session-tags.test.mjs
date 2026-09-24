import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TagPill,
  SessionTagBadges,
  TagFilterBar,
  TagDialog,
  normalizeTag,
  tagColor,
  tagColorSoft,
  readSessionTagsMap,
  writeSessionTagsMap,
  getSessionTags,
  setSessionTags,
  addSessionTag,
  removeSessionTag,
  toggleSessionTag,
  getAllRouteTags,
  parseSessionQuery,
  matchesSessionFilter,
  toggleTagInQuery
} from '../desktop-plugin/desktop/plugin.js'

test('Session Tagging: Normalization & Color Contracts', async (t) => {
  await t.test('normalizeTag normalizes case, removes accents, strips leading hash, replaces spaces with hyphens', () => {
    assert.equal(normalizeTag('#Bug'), 'bug')
    assert.equal(normalizeTag('  Deep-Dive  '), 'deep-dive')
    assert.equal(normalizeTag('high priority!'), 'high-priority')
    assert.equal(normalizeTag('café_latte'), 'cafe_latte')
    assert.equal(normalizeTag('---ops---'), 'ops')
    assert.equal(normalizeTag('a'.repeat(40)), 'a'.repeat(32))
    assert.equal(normalizeTag(''), '')
    assert.equal(normalizeTag(null), '')
  })

  await t.test('tagColor produces deterministic HSL color string', () => {
    const c1 = tagColor('bug')
    const c2 = tagColor('bug')
    const c3 = tagColor('feature')
    assert.equal(c1, c2)
    assert.match(c1, /^hsl\(\d+ 68% 58%\)$/)
    assert.notEqual(c1, c3)
  })

  await t.test('tagColorSoft formats color-mix correctly', () => {
    const c = 'hsl(120 68% 58%)'
    assert.equal(tagColorSoft(c, 20), 'color-mix(in srgb, hsl(120 68% 58%) 20%, transparent)')
  })
})

test('Session Tagging: Storage & Map CRUD Operations', async (t) => {
  const fakeRoute = { connectionId: 'local', mode: 'local', profile: 'test-profile', targetProfile: 'test-profile' }

  // Ensure fresh mock storage
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map()
    globalThis.localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear()
    }
  }

  await t.test('read and write session tags map', () => {
    const map = {
      'sess_1': ['bug', 'urgent'],
      'sess_2': ['frontend']
    }
    writeSessionTagsMap(fakeRoute, map)
    const read = readSessionTagsMap(fakeRoute)
    assert.deepEqual(read['sess_1'], ['bug', 'urgent'])
    assert.deepEqual(read['sess_2'], ['frontend'])
  })

  await t.test('getSessionTags returns empty array for untagged sessions', () => {
    assert.deepEqual(getSessionTags('unknown_sess', fakeRoute), [])
  })

  await t.test('addSessionTag and removeSessionTag mutate session list properly', () => {
    addSessionTag('sess_3', 'ops', fakeRoute)
    assert.deepEqual(getSessionTags('sess_3', fakeRoute), ['ops'])

    addSessionTag('sess_3', 'investigation', fakeRoute)
    assert.deepEqual(getSessionTags('sess_3', fakeRoute), ['ops', 'investigation'])

    removeSessionTag('sess_3', 'ops', fakeRoute)
    assert.deepEqual(getSessionTags('sess_3', fakeRoute), ['investigation'])
  })

  await t.test('toggleSessionTag toggles tag state', () => {
    toggleSessionTag('sess_4', 'wip', fakeRoute)
    assert.deepEqual(getSessionTags('sess_4', fakeRoute), ['wip'])
    toggleSessionTag('sess_4', 'wip', fakeRoute)
    assert.deepEqual(getSessionTags('sess_4', fakeRoute), [])
  })

  await t.test('getAllRouteTags aggregates unique sorted tags', () => {
    const all = getAllRouteTags(fakeRoute)
    assert.ok(all.includes('bug'))
    assert.ok(all.includes('urgent'))
    assert.ok(all.includes('frontend'))
    assert.ok(all.includes('investigation'))
    // Check sorted
    const sorted = [...all].sort()
    assert.deepEqual(all, sorted)
  })
})

test('Session Tagging: Query Parsing & Filter Matching', async (t) => {
  await t.test('parseSessionQuery extracts tags and text tokens', () => {
    const parsed = parseSessionQuery('fix #bug #urgent sidebar')
    assert.deepEqual(parsed.tags, ['bug', 'urgent'])
    assert.deepEqual(parsed.text, ['fix', 'sidebar'])
  })

  await t.test('matchesSessionFilter matches both required tags and text', () => {
    const session = {
      id: 'sess_100',
      title: 'Fix sidebar navigation collapse bug',
      preview: 'investigating state issue'
    }
    const tags = ['bug', 'desktop']

    // Matches tag and text
    assert.equal(matchesSessionFilter(session, '#bug sidebar', tags), true)
    // Fails tag
    assert.equal(matchesSessionFilter(session, '#urgent sidebar', tags), false)
    // Fails text
    assert.equal(matchesSessionFilter(session, '#bug database', tags), false)
  })

  await t.test('toggleTagInQuery appends or removes #tag token', () => {
    assert.equal(toggleTagInQuery('fix issues', 'bug'), 'fix issues #bug')
    assert.equal(toggleTagInQuery('fix issues #bug', 'bug'), 'fix issues')
    assert.equal(toggleTagInQuery('#bug', 'bug'), '')
  })
})

test('Session Tagging: UI Component Contracts', async (t) => {
  await t.test('TagPill renders with formatted style and color', () => {
    const pill = TagPill({ tag: 'ops', active: true })
    assert.ok(pill)
    assert.equal(pill.props.title, 'Active tag filter: #ops')
    assert.ok(pill.props.style.backgroundColor.includes('color-mix'))
  })

  await t.test('SessionTagBadges renders up to maxVisible badges and overflow indicator', () => {
    const badges = SessionTagBadges({ tags: ['bug', 'urgent', 'release'], maxVisible: 2 })
    assert.ok(badges)
    assert.equal(badges.props.children[0].length, 2) // visible pills
    assert.ok(badges.props.children[1]) // overflow indicator +1
    assert.equal(badges.props.children[1].props.children, '+1')
  })
})
