import test from 'node:test'
import assert from 'node:assert/strict'
import {
  whereStateAtom,
  whereOpenAtom,
  openWhereDialog,
  closeWhereDialog,
  SessionRow,
  ProjectCard,
  NavigatorShell
} from '../desktop-plugin/desktop/plugin.js'

test('Where Dialog State Primitives & Atoms', async (t) => {
  // Ensure clean slate before tests
  closeWhereDialog()

  await t.test('initial state is open: false and route: null', () => {
    assert.deepEqual(whereStateAtom.get(), { open: false, route: null })
    assert.equal(whereOpenAtom.get(), false)
  })

  await t.test('openWhereDialog(route) updates state with open: true and preserves route', () => {
    const testRoute = { connectionId: 'local', mode: 'local', profile: 'tabby', targetProfile: 'tabby' }
    openWhereDialog(testRoute)
    assert.deepEqual(whereStateAtom.get(), { open: true, route: testRoute })
    assert.equal(whereOpenAtom.get(), true)
  })

  await t.test('closeWhereDialog() resets open to false and route to null', () => {
    closeWhereDialog()
    assert.deepEqual(whereStateAtom.get(), { open: false, route: null })
    assert.equal(whereOpenAtom.get(), false)
  })

  await t.test('openWhereDialog() without route defaults route to null', () => {
    openWhereDialog()
    assert.deepEqual(whereStateAtom.get(), { open: true, route: null })
    assert.equal(whereOpenAtom.get(), true)
  })

  await t.test('whereOpenAtom setter updates open state properly', () => {
    closeWhereDialog()
    whereOpenAtom.set(true)
    assert.equal(whereOpenAtom.get(), true)
    assert.equal(whereStateAtom.get().open, true)

    whereOpenAtom.set(false)
    assert.equal(whereOpenAtom.get(), false)
    assert.equal(whereStateAtom.get().open, false)
  })
})

test('Where Dialog & Context Menu Component Invariants', async (t) => {
  closeWhereDialog()
  const testRoute = { connectionId: 'local', mode: 'local', profile: 'test-profile', targetProfile: 'test-profile' }

  await t.test('SessionRow renders "New session (choose location)…" item and handles trigger', () => {
    const session = { id: 'sess_123', title: 'Test Session', profile: 'default' }
    const project = { id: 'p1', name: 'MyProject', label: 'My Project', isNoProject: false }

    const rendered = SessionRow({ session, project, route: testRoute })
    assert.ok(rendered, 'SessionRow should render')

    // Find ContextMenu in children
    const contextMenu = rendered.props?.children?.find?.(c => c && c.type === 'ContextMenu')
    assert.ok(contextMenu, 'SessionRow must contain a ContextMenu')

    const menuContent = contextMenu.props?.children?.find?.(c => c && c.type === 'ContextMenuContent')
    assert.ok(menuContent, 'ContextMenu must have Content')

    // Check menu items
    const items = (menuContent.props?.children || []).flat().filter(Boolean)
    const chooseLocationItem = items.find(it => {
      const span = it.props?.children?.find?.(c => c && c.props?.children === 'New session (choose location)…')
      return Boolean(span)
    })
    assert.ok(chooseLocationItem, 'Should have "New session (choose location)…" menu item')

    // Selecting it opens where dialog with route
    chooseLocationItem.props.onSelect()
    assert.equal(whereStateAtom.get().open, true)
    assert.deepEqual(whereStateAtom.get().route, testRoute)

    closeWhereDialog()
  })

  await t.test('SessionRow in flat timeline (no project) still renders chooser item', () => {
    const session = { id: 'sess_timeline', title: 'Timeline Session', profile: 'default' }
    const rendered = SessionRow({ session, route: testRoute })
    const contextMenu = rendered.props?.children?.find?.(c => c && c.type === 'ContextMenu')
    const menuContent = contextMenu.props?.children?.find?.(c => c && c.type === 'ContextMenuContent')
    const items = (menuContent.props?.children || []).flat().filter(Boolean)

    const chooseLocationItem = items.find(it => {
      const span = it.props?.children?.find?.(c => c && c.props?.children === 'New session (choose location)…')
      return Boolean(span)
    })
    assert.ok(chooseLocationItem, 'Timeline session row must have "New session (choose location)…"')

    const projectFastPath = items.find(it => {
      const span = it.props?.children?.find?.(c => c && String(c.props?.children).startsWith('New session in'))
      return Boolean(span)
    })
    assert.equal(projectFastPath, undefined, 'Timeline session row without project should not have fast-path item')
  })

  await t.test('ProjectCard renders both fast-path and chooser items', () => {
    const project = { id: 'p_alpha', name: 'Alpha', label: 'Alpha Project', isNoProject: false }
    const rendered = ProjectCard({ project, route: testRoute })
    assert.ok(rendered, 'ProjectCard should render')

    const contextMenu = rendered.props?.children?.find?.(c => c && c.type === 'ContextMenu')
    assert.ok(contextMenu, 'ProjectCard must contain a ContextMenu')

    const menuContent = contextMenu.props?.children?.find?.(c => c && c.type === 'ContextMenuContent')
    const items = (menuContent.props?.children || []).flat().filter(Boolean)

    const fastPathItem = items.find(it => {
      const span = it.props?.children?.find?.(c => c && c.props?.children === 'New session in Alpha Project')
      return Boolean(span)
    })
    assert.ok(fastPathItem, 'ProjectCard must have fast-path "New session in <Project>"')

    const chooseItem = items.find(it => {
      const span = it.props?.children?.find?.(c => c && c.props?.children === 'New session (choose location)…')
      return Boolean(span)
    })
    assert.ok(chooseItem, 'ProjectCard must have "New session (choose location)…"')

    // Click chooser
    chooseItem.props.onSelect()
    assert.equal(whereStateAtom.get().open, true)
    assert.deepEqual(whereStateAtom.get().route, testRoute)
    closeWhereDialog()
  })

  await t.test('NavigatorShell wraps browser surface in root ContextMenu', () => {
    const rendered = NavigatorShell()
    assert.ok(rendered, 'NavigatorShell should render')

    const rootContextMenu = rendered.props?.children?.find?.(c => c && c.type === 'ContextMenu')
    assert.ok(rootContextMenu, 'NavigatorShell should have root ContextMenu for unclaimed space')

    const menuContent = rootContextMenu.props?.children?.find?.(c => c && c.type === 'ContextMenuContent')
    assert.ok(menuContent, 'Root ContextMenu must have ContextMenuContent')

    const items = (menuContent.props?.children || []).flat().filter(Boolean)
    const chooseItem = items.find(it => {
      const span = it.props?.children?.find?.(c => c && c.props?.children === 'New session (choose location)…')
      return Boolean(span)
    })
    assert.ok(chooseItem, 'Root ContextMenu must have "New session (choose location)…"')
  })
})
