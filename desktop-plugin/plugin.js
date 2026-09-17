/**
 * HA-Plugins-sidebar-navigator — Full-Power Sidebar Navigator for Hermes Desktop.
 *
 * Provides an uncapped, inner-scrolling, searchable project & session browser.
 * Bypasses the default 3-session sidebar overview limit.
 *
 * Loaded uncompiled by Hermes Desktop via @hermes/plugin-sdk.
 */

import {
  Button,
  Codicon,
  ColorSwatches,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  KEYBINDS_AREA,
  PALETTE_AREA,
  PROFILE_SWATCHES,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  atom,
  haptic,
  host,
  icons,
  queryClient,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'ha-sidebar-navigator'
const SESSIONS_LIMIT = 500
const TREE_PREVIEW_LIMIT = 100
const PROJECT_SESSION_LIMIT = 2000

const viewAtom = atom('projects')
const queryAtom = atom('')

function setView(view) {
  if (view === 'sessions' || view === 'projects') {
    viewAtom.set(view)
  }
}

// Track focused session from location hash
function focusIdFromLocation() {
  if (typeof window === 'undefined') return ''
  const raw = (window.location.hash || '').slice(1) || '/'
  const path = raw.split('?')[0]
  if (path === '/' || path.startsWith('/settings') || path.startsWith('/command-center') || path.startsWith('/navigator')) {
    return ''
  }
  const id = path.slice(1)
  return id && !id.includes('/') ? decodeURIComponent(id) : ''
}

const focusAtom = atom(typeof window !== 'undefined' ? focusIdFromLocation() : '')

if (typeof window !== 'undefined') {
  const sync = () => focusAtom.set(focusIdFromLocation())
  window.addEventListener('hashchange', sync)
  window.addEventListener('popstate', sync)
}

function sessionRoute(id) {
  return '/' + encodeURIComponent(id)
}

function timeAgo(seconds) {
  if (!seconds) return ''
  const mins = Math.max(0, Math.floor((Date.now() / 1000 - seconds) / 60))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

function formatTokens(tokens) {
  if (!tokens) return '0'
  if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(1) + 'M'
  if (tokens >= 1_000) return (tokens / 1_000).toFixed(0) + 'k'
  return String(tokens)
}

// ── Shared UI Tokens & Styles ─────────────────────────────────────────────

const hintStyle = 'text-[0.75rem] leading-snug text-(--ui-text-quaternary)'
const rowBtn =
  'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] ' +
  'text-(--ui-text-primary) transition-colors hover:bg-(--chrome-action-hover)'
const rowBtnActive =
  rowBtn + ' bg-(--chrome-action-hover) font-medium border-l-2 border-(--ui-accent)'
const chipBtn =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-(--ui-stroke-secondary) ' +
  'text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) ' +
  'hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
const segActive =
  'rounded-md px-2.5 py-1 text-[0.75rem] font-medium bg-(--ui-accent) text-(--ui-bg-primary)'
const segIdle =
  'rounded-md px-2.5 py-1 text-[0.75rem] font-medium text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'

function IconOr({ icon, glyph }) {
  const Cmp = icons?.[icon]
  return Cmp ? jsx(Cmp, { className: 'h-3.5 w-3.5 shrink-0' }) : jsx('span', { className: 'text-xs shrink-0', children: glyph })
}

// ── Session Context Menu Actions & Storage Helpers ──────────────────────────

function isSessionPinned(sessionId, session) {
  if (session?.pinned === true) return true
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem('hermes.desktop.pinnedSessions') : null
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list) && list.includes(sessionId)) return true
    }
  } catch {}
  return false
}

function getSessionColorOverride(sessionId) {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem('hermes.desktop.sessionColors') : null
    if (raw) {
      const map = JSON.parse(raw)
      if (map && map[sessionId]) return map[sessionId]
    }
  } catch {}
  return null
}

function setSessionColorOverride(sessionId, color) {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem('hermes.desktop.sessionColors') : null
    const map = raw ? JSON.parse(raw) || {} : {}
    if (color) {
      map[sessionId] = color
    } else {
      delete map[sessionId]
    }
    window.localStorage?.setItem('hermes.desktop.sessionColors', JSON.stringify(map))
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'hermes.desktop.sessionColors',
      newValue: JSON.stringify(map)
    }))
  } catch (err) {
    console.warn('Failed to update session color override', err)
  }
}

async function toggleSessionPin(sessionId, currentlyPinned, profile) {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem('hermes.desktop.pinnedSessions') : null
    let list = []
    if (raw) {
      try { list = JSON.parse(raw) || [] } catch {}
    }
    if (currentlyPinned) {
      list = list.filter(id => id !== sessionId)
    } else {
      if (!list.includes(sessionId)) list.unshift(sessionId)
    }
    window.localStorage?.setItem('hermes.desktop.pinnedSessions', JSON.stringify(list))
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'hermes.desktop.pinnedSessions',
      newValue: JSON.stringify(list)
    }))
  } catch (err) {
    console.warn('Failed to update pinned sessions in storage', err)
  }

  if (typeof window !== 'undefined' && window.hermesDesktop?.api) {
    try {
      await window.hermesDesktop.api({
        path: `/api/sessions/${encodeURIComponent(sessionId)}`,
        method: 'PATCH',
        body: { pinned: !currentlyPinned, ...(profile ? { profile } : {}) }
      })
    } catch (err) {
      console.warn('Backend pin PATCH failed', err)
    }
  }
}

async function toggleSessionUnread(sessionId, currentlyUnread, profile) {
  if (typeof window !== 'undefined' && window.hermesDesktop?.api) {
    try {
      await window.hermesDesktop.api({
        path: `/api/sessions/${encodeURIComponent(sessionId)}`,
        method: 'PATCH',
        body: { unread: !currentlyUnread, ...(profile ? { profile } : {}) }
      })
    } catch (err) {
      console.warn('Backend unread PATCH failed', err)
    }
  }
}

function copySessionId(sessionId) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(sessionId).then(() => {
      host.notify({ kind: 'success', message: 'Session ID copied to clipboard' })
    }).catch(err => host.notifyError?.(err, 'Failed to copy session ID'))
  } else if (typeof window !== 'undefined' && window.hermesDesktop?.writeClipboard) {
    window.hermesDesktop.writeClipboard(sessionId)
    host.notify({ kind: 'success', message: 'Session ID copied to clipboard' })
  }
}

async function branchSession(session, profile) {
  host.notify({ kind: 'info', message: 'Branching session…' })
  try {
    if (typeof window !== 'undefined' && window.hermesDesktop?.api) {
      const res = await window.hermesDesktop.api({
        path: `/api/sessions/${encodeURIComponent(session.id)}/fork`,
        method: 'POST',
        body: { ...(profile ? { profile } : {}) }
      })
      if (res?.session?.id) {
        queryClient.invalidateQueries({ queryKey: [ID] })
        host.navigate(sessionRoute(res.session.id))
        host.notify({ kind: 'success', message: 'Branched to new session' })
        return
      }
    }
    const res = await host.request('session.branch', {
      session_id: session.id,
      profile
    })
    const newId = res?.session_key || res?.session_id
    if (newId) {
      queryClient.invalidateQueries({ queryKey: [ID] })
      host.navigate(sessionRoute(newId))
      host.notify({ kind: 'success', message: 'Branched to new session' })
    }
  } catch (err) {
    host.notifyError?.(err, 'Failed to branch session')
  }
}

async function exportSession(session, profile) {
  host.notify({ kind: 'info', message: 'Preparing session export…' })
  try {
    let messages = []
    if (typeof window !== 'undefined' && window.hermesDesktop?.api) {
      try {
        const res = await window.hermesDesktop.api({
          path: `/api/sessions/${encodeURIComponent(session.id)}/messages?limit=5000&includeCompacted=true`,
          method: 'GET'
        })
        messages = res?.messages || []
      } catch (e) {
        console.warn('Failed to get full messages for export', e)
      }
    }
    const payload = {
      exported_at: new Date().toISOString(),
      session_id: session.id,
      title: session.title || null,
      session,
      message_count: messages.length,
      messages
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const downloadUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    const safeTitle = (session.title || 'session')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    anchor.download = `${safeTitle || 'session'}-${session.id.slice(0, 8)}.json`
    anchor.click()
    URL.revokeObjectURL(downloadUrl)
    host.notify({ kind: 'success', message: 'Session exported successfully' })
  } catch (err) {
    host.notifyError?.(err, 'Failed to export session')
  }
}

async function moveSessionToProject(sessionId, project) {
  const targetCwd = (project?.path || project?.repos?.find(r => r.path)?.path || '').trim()
  if (!targetCwd) {
    host.notify({ kind: 'error', message: 'Target project has no directory path' })
    return
  }
  try {
    await host.request('session.workspace.move', {
      session_key: sessionId,
      cwd: targetCwd
    })
    queryClient.invalidateQueries({ queryKey: [ID] })
    host.notify({ kind: 'success', message: `Moved to ${project.label || project.name || project.id}` })
  } catch (err) {
    host.notifyError?.(err, 'Failed to move session to project')
  }
}

async function archiveSession(sessionId, profile) {
  try {
    if (typeof window !== 'undefined' && window.hermesDesktop?.api) {
      await window.hermesDesktop.api({
        path: `/api/sessions/${encodeURIComponent(sessionId)}`,
        method: 'PATCH',
        body: { archived: true, ...(profile ? { profile } : {}) }
      })
    }
    queryClient.invalidateQueries({ queryKey: [ID] })
    host.notify({ kind: 'success', message: 'Session archived' })
  } catch (err) {
    host.notifyError?.(err, 'Failed to archive session')
  }
}

async function deleteSession(sessionId, profile) {
  try {
    if (typeof window !== 'undefined' && window.hermesDesktop?.api) {
      await window.hermesDesktop.api({
        path: `/api/sessions/${encodeURIComponent(sessionId)}`,
        method: 'DELETE',
        body: { ...(profile ? { profile } : {}) }
      })
    } else {
      await host.request('session.delete', {
        session_id: sessionId,
        profile
      })
    }
    queryClient.invalidateQueries({ queryKey: [ID] })
    host.notify({ kind: 'success', message: 'Session deleted' })
    if (focusAtom.get() === sessionId) {
      host.navigate('/')
    }
  } catch (err) {
    host.notifyError?.(err, 'Failed to delete session')
  }
}

async function openSessionInNewWindow(sessionId, profile) {
  if (typeof window !== 'undefined' && window.hermesDesktop?.openSessionWindow) {
    try {
      await window.hermesDesktop.openSessionWindow(sessionId, { profile })
      return
    } catch (e) {
      console.warn('openSessionWindow failed', e)
    }
  }
  host.openSession(sessionId, { intent: 'window' })
}

// ── Session Row with Context Menu ───────────────────────────────────────────

function SessionRow({ session, focused, project, allProjects }) {
  const isCurrent = focused || session.id === focusAtom.get()
  const profile = useValue(host.state.profile)
  const rowProfile = session.profile || profile
  const tokenStr = formatTokens((session.input_tokens || 0) + (session.output_tokens || 0))
  const ageStr = timeAgo(session.started_at)
  const meta = [tokenStr !== '0' ? tokenStr : null, ageStr].filter(Boolean).join(' · ')

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(session.title || '')
  const [renaming, setRenaming] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const [pinned, setPinned] = useState(() => isSessionPinned(session.id, session))
  const [unread, setUnread] = useState(() => Boolean(session.unread))
  const [colorOverride, setColorOverride] = useState(() => getSessionColorOverride(session.id))

  // Find target projects for "Move to project"
  const currentProjectId = project?.id
  const currentCwd = session.cwd || (project?.path || project?.repos?.find(r => r.path)?.path || '').trim()
  const targetProjects = (allProjects || []).filter((p) => {
    if (p.isNoProject) return false
    if (currentProjectId && p.id === currentProjectId) return false
    const rootPath = (p.path || p.repos?.find(r => r.path)?.path || '').trim()
    if (!rootPath) return false
    if (currentCwd && rootPath === currentCwd) return false
    return true
  })

  const submitRename = async () => {
    const next = renameValue.trim()
    if (!next || next === (session.title || '').trim()) {
      setRenameOpen(false)
      return
    }
    setRenaming(true)
    try {
      if (typeof window !== 'undefined' && window.hermesDesktop?.api) {
        await window.hermesDesktop.api({
          path: `/api/sessions/${encodeURIComponent(session.id)}`,
          method: 'PATCH',
          body: { title: next, ...(rowProfile ? { profile: rowProfile } : {}) }
        })
      } else {
        await host.request('session.title', { session_id: session.id, title: next })
      }
      queryClient.invalidateQueries({ queryKey: [ID] })
      host.notify({ kind: 'success', message: 'Renamed session' })
      setRenameOpen(false)
    } catch (err) {
      host.notifyError?.(err, 'Failed to rename session')
    } finally {
      setRenaming(false)
    }
  }

  const rowButton = jsxs('button', {
    type: 'button',
    className: isCurrent ? rowBtnActive : rowBtn,
    onClick: () => host.navigate(sessionRoute(session.id)),
    title: session.title || session.preview || session.id,
    children: [
      jsx('span', {
        className: 'inline-block h-2 w-2 shrink-0 rounded-full bg-(--ui-accent) opacity-80 group-hover:opacity-100',
        style: colorOverride ? { backgroundColor: colorOverride, opacity: 1 } : undefined
      }),
      jsx('span', {
        className: 'min-w-0 flex-1 truncate text-left',
        children: session.title || session.preview || session.id
      }),
      meta ? jsx('span', {
        className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary) tabular-nums',
        children: meta
      }) : null
    ]
  })

  return jsxs('div', {
    className: 'relative w-full',
    children: [
      jsxs(ContextMenu, {
        children: [
          jsx(ContextMenuTrigger, {
            asChild: true,
            children: rowButton
          }),
          jsxs(ContextMenuContent, {
            className: 'w-48',
            children: [
              // 1. New window
              jsxs(ContextMenuItem, {
                onSelect: () => {
                  haptic?.('selection')
                  void openSessionInNewWindow(session.id, rowProfile)
                },
                children: [
                  jsx(Codicon, { name: 'link-external', size: '0.875rem' }),
                  jsx('span', { children: 'New window' })
                ]
              }),
              // 2. Rename...
              jsxs(ContextMenuItem, {
                onSelect: () => {
                  haptic?.('selection')
                  setRenameValue(session.title || '')
                  setRenameOpen(true)
                },
                children: [
                  jsx(Codicon, { name: 'edit', size: '0.875rem' }),
                  jsx('span', { children: 'Rename…' })
                ]
              }),
              // 3. Pin / Unpin
              jsxs(ContextMenuItem, {
                onSelect: () => {
                  haptic?.('selection')
                  const next = !pinned
                  setPinned(next)
                  void toggleSessionPin(session.id, pinned, rowProfile)
                  host.notify({
                    kind: 'info',
                    message: next ? 'Pinned session to top' : 'Unpinned session'
                  })
                },
                children: [
                  jsx(Codicon, { name: 'pin', size: '0.875rem' }),
                  jsx('span', { children: pinned ? 'Unpin' : 'Pin' })
                ]
              }),
              // 4. Mark as unread / Mark as read
              jsxs(ContextMenuItem, {
                onSelect: () => {
                  haptic?.('selection')
                  const next = !unread
                  setUnread(next)
                  void toggleSessionUnread(session.id, unread, rowProfile)
                  host.notify({
                    kind: 'info',
                    message: next ? 'Marked as unread' : 'Marked as read'
                  })
                },
                children: [
                  jsx(Codicon, { name: unread ? 'mail-read' : 'mail', size: '0.875rem' }),
                  jsx('span', { children: unread ? 'Mark as read' : 'Mark as unread' })
                ]
              }),
              // 5. Appearance
              jsxs(ContextMenuSub, {
                children: [
                  jsxs(ContextMenuSubTrigger, {
                    children: [
                      jsx(Codicon, { name: 'symbol-color', size: '0.875rem' }),
                      jsx('span', { children: 'Appearance' })
                    ]
                  }),
                  jsx(ContextMenuSubContent, {
                    className: 'p-2',
                    children: jsx(ColorSwatches, {
                      clearIcon: 'circle-slash',
                      clearLabel: 'No color',
                      onChange: (color) => {
                        haptic?.('selection')
                        setColorOverride(color)
                        setSessionColorOverride(session.id, color)
                      },
                      swatches: PROFILE_SWATCHES,
                      value: colorOverride
                    })
                  })
                ]
              }),
              // 6. Copy ID
              jsxs(ContextMenuItem, {
                onSelect: () => {
                  haptic?.('selection')
                  copySessionId(session.id)
                },
                children: [
                  jsx(Codicon, { name: 'copy', size: '0.875rem' }),
                  jsx('span', { children: 'Copy ID' })
                ]
              }),
              // Separator 1
              jsx(ContextMenuSeparator, {}),
              // 7. Branch
              jsxs(ContextMenuItem, {
                onSelect: () => void branchSession(session, rowProfile),
                children: [
                  jsx(Codicon, { name: 'repo-forked', size: '0.875rem' }),
                  jsx('span', { children: 'Branch' })
                ]
              }),
              // 8. Export
              jsxs(ContextMenuItem, {
                onSelect: () => void exportSession(session, rowProfile),
                children: [
                  jsx(Codicon, { name: 'cloud-download', size: '0.875rem' }),
                  jsx('span', { children: 'Export' })
                ]
              }),
              // 9. Move to project
              jsxs(ContextMenuSub, {
                children: [
                  jsxs(ContextMenuSubTrigger, {
                    children: [
                      jsx(Codicon, { name: 'folder', size: '0.875rem' }),
                      jsx('span', { children: 'Move to project' })
                    ]
                  }),
                  jsx(ContextMenuSubContent, {
                    children: targetProjects.length === 0
                      ? jsx(ContextMenuItem, { disabled: true, children: 'No other projects' })
                      : targetProjects.map(proj =>
                          jsx(ContextMenuItem, {
                            key: proj.id,
                            onSelect: () => void moveSessionToProject(session.id, proj),
                            children: proj.label || proj.name || proj.id
                          })
                        )
                  })
                ]
              }),
              // Separator 2
              jsx(ContextMenuSeparator, {}),
              // 10. Archive
              jsxs(ContextMenuItem, {
                onSelect: () => void archiveSession(session.id, rowProfile),
                children: [
                  jsx(Codicon, { name: 'archive', size: '0.875rem' }),
                  jsx('span', { children: 'Archive' })
                ]
              }),
              // 11. Delete
              jsxs(ContextMenuItem, {
                variant: 'destructive',
                className: 'text-destructive focus:text-destructive',
                onSelect: () => {
                  haptic?.('warning')
                  setDeleteOpen(true)
                },
                children: [
                  jsx(Codicon, { name: 'trash', size: '0.875rem' }),
                  jsx('span', { children: 'Delete' })
                ]
              })
            ]
          })
        ]
      }),
      // Rename Dialog
      jsx(Dialog, {
        open: renameOpen,
        onOpenChange: setRenameOpen,
        children: jsxs(DialogContent, {
          className: 'max-w-md',
          children: [
            jsx(DialogHeader, {
              children: jsx(DialogTitle, { children: 'Rename session' })
            }),
            jsx(Input, {
              autoFocus: true,
              disabled: renaming,
              value: renameValue,
              onChange: (e) => setRenameValue(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void submitRename()
                } else if (e.key === 'Escape') {
                  setRenameOpen(false)
                }
              },
              placeholder: 'Untitled session'
            }),
            jsxs(DialogFooter, {
              children: [
                jsx(Button, {
                  type: 'button',
                  variant: 'ghost',
                  disabled: renaming,
                  onClick: () => setRenameOpen(false),
                  children: 'Cancel'
                }),
                jsx(Button, {
                  type: 'button',
                  disabled: renaming,
                  onClick: () => void submitRename(),
                  children: renaming ? 'Saving…' : 'Save'
                })
              ]
            })
          ]
        })
      }),
      // Delete Confirmation Dialog
      jsx(ConfirmDialog, {
        open: deleteOpen,
        onClose: () => setDeleteOpen(false),
        title: 'Delete session',
        description: `Are you sure you want to delete "${session.title || session.preview || session.id}"? This action cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
        onConfirm: () => deleteSession(session.id, rowProfile)
      })
    ]
  })
}

// ── Sessions Flattened View ──────────────────────────────────────────────────

function SessionBrowser() {
  const profile = useValue(host.state.profile)
  const q = useValue(queryAtom).trim().toLowerCase()
  const currentId = useValue(focusAtom)

  const listQuery = useQuery({
    queryKey: [ID, 'sessions', profile],
    queryFn: () => host.request('session.list', { limit: SESSIONS_LIMIT }),
    refetchInterval: 15000,
    staleTime: 5000
  })

  const treeQuery = useQuery({
    queryKey: [ID, 'projects-tree', profile],
    queryFn: () => host.request('projects.tree', { preview_limit: TREE_PREVIEW_LIMIT }),
    staleTime: 8000
  })

  const allProjects = treeQuery.data?.projects || []
  const rawSessions = listQuery.data?.sessions ?? []
  const filtered = rawSessions
    .filter((s) => (s.message_count ?? 0) > 0)
    .filter((s) => {
      if (!q) return true
      return (s.title || '').toLowerCase().includes(q) ||
             (s.preview || '').toLowerCase().includes(q) ||
             (s.id || '').toLowerCase().includes(q)
    })
    .sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))

  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col overflow-hidden',
    children: [
      jsx('div', {
        className: `${hintStyle} px-3 py-1`,
        children: listQuery.status === 'pending'
          ? 'Loading sessions…'
          : listQuery.status === 'error'
            ? 'Failed to retrieve session list.'
            : `${filtered.length} session${filtered.length === 1 ? '' : 's'}`
      }),
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto px-1.5 pb-3',
        children: filtered.map((s) =>
          jsx(SessionRow, { session: s, focused: s.id === currentId, allProjects }, s.id)
        )
      })
    ]
  })
}

// ── Projects Grouped View ────────────────────────────────────────────────────

function extractSessionsFromProjectTree(project) {
  if (!project) return []
  const rows = []
  for (const repo of project.repos ?? []) {
    for (const group of repo.groups ?? []) {
      for (const session of group.sessions ?? []) {
        if (session?.id) rows.push(session)
      }
    }
  }
  return rows
}

function ProjectCard({ project, allProjects, currentId, filterQuery }) {
  const [expanded, setExpanded] = useState(true)
  const [loadAll, setLoadAll] = useState(false)

  const preview = project.previewSessions ?? []
  const totalCount = Number(project.sessionCount ?? preview.length)

  // Full session fetch when requested or if totalCount > preview.length
  const fullQuery = useQuery({
    queryKey: [ID, 'project-sessions', project.id],
    queryFn: () => host.request('projects.project_sessions', {
      project_id: project.id,
      session_limit: PROJECT_SESSION_LIMIT
    }),
    enabled: loadAll,
    staleTime: 10000
  })

  let sessions = loadAll
    ? extractSessionsFromProjectTree(fullQuery.data?.project)
    : preview

  if (filterQuery) {
    sessions = sessions.filter((s) =>
      (s.title || '').toLowerCase().includes(filterQuery) ||
      (s.preview || '').toLowerCase().includes(filterQuery) ||
      (s.id || '').toLowerCase().includes(filterQuery)
    )
  }

  const hasTruncated = !loadAll && totalCount > preview.length

  return jsxs('div', {
    className: 'mb-3 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-subtle)/30 p-1.5',
    children: [
      // Project Header
      jsxs('div', {
        className: 'flex w-full items-center gap-1.5 px-2 py-1 cursor-pointer select-none rounded hover:bg-(--chrome-action-hover)',
        onClick: () => setExpanded(!expanded),
        children: [
          jsx('button', {
            type: 'button',
            className: 'text-(--ui-text-quaternary) hover:text-(--ui-text-primary) p-0.5',
            children: jsx(IconOr, {
              icon: expanded ? 'ChevronDown' : 'ChevronRight',
              glyph: expanded ? '▼' : '▶'
            })
          }),
          project.color
            ? jsx('span', {
                className: 'h-2.5 w-2.5 shrink-0 rounded-full',
                style: { backgroundColor: project.color }
              })
            : project.isNoProject
              ? jsx(IconOr, { icon: 'Home', glyph: '🏠' })
              : jsx(IconOr, { icon: 'Folder', glyph: '📁' }),
          jsx('span', {
            className: 'min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider text-(--ui-text-primary)',
            children: project.isNoProject ? 'Home' : (project.label || project.name || project.id)
          }),
          !project.isNoProject ? jsx('button', {
            type: 'button',
            className: 'shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium text-(--ui-text-secondary) hover:text-(--ui-text-primary) hover:bg-(--chrome-action-hover) border border-(--ui-stroke-secondary) transition-colors',
            title: `Open Cockpit for ${project.label || project.name || project.id}`,
            onClick: (e) => {
              e.stopPropagation()
              const slug = project.id || project.name || project.label || ''
              host.navigate(`/cockpit?project=${encodeURIComponent(slug)}`)
            },
            children: [
              jsx(IconOr, { icon: 'Zap', glyph: '⚡' }),
              jsx('span', { className: 'hidden sm:inline', children: 'Cockpit' })
            ]
          }) : null,
          jsx('span', {
            className: 'shrink-0 text-[0.6875rem] font-medium text-(--ui-text-quaternary) tabular-nums',
            children: String(totalCount)
          })
        ]
      }),

      // Inner Sessions List
      expanded ? jsxs('div', {
        className: 'mt-1 flex flex-col',
        children: [
          jsx('div', {
            className: 'max-h-72 min-h-0 overflow-y-auto pl-2 pr-1 space-y-0.5',
            children: loadAll && fullQuery.status === 'pending'
              ? jsx('div', { className: `${hintStyle} px-2 py-1`, children: 'Loading full history…' })
              : sessions.length === 0
                ? jsx('div', { className: `${hintStyle} px-2 py-1`, children: 'No matching sessions' })
                : sessions.map((s) =>
                    jsx(SessionRow, { session: s, focused: s.id === currentId, project, allProjects }, `${project.id}/${s.id}`)
                  )
          }),
          hasTruncated ? jsx('button', {
            type: 'button',
            className: 'mt-1 w-full rounded py-1 text-center text-[0.6875rem] font-medium text-(--ui-accent) hover:bg-(--chrome-action-hover) transition-colors',
            onClick: () => setLoadAll(true),
            children: `Show all ${totalCount} sessions`
          }) : null
        ]
      }) : null
    ]
  })
}

function ProjectBrowser() {
  const profile = useValue(host.state.profile)
  const q = useValue(queryAtom).trim().toLowerCase()
  const currentId = useValue(focusAtom)

  const treeQuery = useQuery({
    queryKey: [ID, 'projects-tree', profile],
    queryFn: () => host.request('projects.tree', { preview_limit: TREE_PREVIEW_LIMIT }),
    refetchInterval: 20000,
    staleTime: 8000
  })

  if (treeQuery.status === 'pending') {
    return jsx('div', { className: `${hintStyle} p-3`, children: 'Loading project catalog…' })
  }

  if (treeQuery.status === 'error') {
    return jsx('div', { className: `${hintStyle} p-3`, children: 'Projects are unavailable on this backend.' })
  }

  const projects = [...(treeQuery.data?.projects ?? [])]
    .sort((a, b) => {
      // Keep Home / unassigned at the top like stock sidebar, then most active
      if (a.isNoProject) return -1
      if (b.isNoProject) return 1
      return (b.lastActive ?? 0) - (a.lastActive ?? 0)
    })

  if (projects.length === 0) {
    return jsx('div', { className: `${hintStyle} p-3`, children: 'No projects registered on this profile.' })
  }

  return jsx('div', {
    className: 'min-h-0 flex-1 overflow-y-auto px-2 py-1.5',
    children: projects.map((p) =>
      jsx(ProjectCard, { project: p, allProjects: projects, currentId, filterQuery: q }, p.id)
    )
  })
}

// ── Navigator Shell (Main Pane) ──────────────────────────────────────────────

function NavigatorShell() {
  const view = useValue(viewAtom)
  const q = useValue(queryAtom)
  const profile = useValue(host.state.profile)

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col bg-(--ui-bg-primary) text-(--ui-text-primary)',
    children: [
      // Top Controls: View switch & Search
      jsxs('div', {
        className: 'flex flex-col gap-2 border-b border-(--ui-stroke-secondary) p-2.5',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-1',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-1 rounded-md bg-(--ui-bg-subtle) p-0.5',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: view === 'projects' ? segActive : segIdle,
                    onClick: () => setView('projects'),
                    children: 'Projects'
                  }),
                  jsx('button', {
                    type: 'button',
                    className: view === 'sessions' ? segActive : segIdle,
                    onClick: () => setView('sessions'),
                    children: 'Timeline'
                  })
                ]
              }),
              jsx('button', {
                type: 'button',
                className: chipBtn,
                title: `Refresh (${profile || 'default'})`,
                onClick: () => void queryClient.invalidateQueries({ queryKey: [ID] }),
                children: jsx(IconOr, { icon: 'RefreshCw', glyph: '↻' })
              })
            ]
          }),
          jsx('input', {
            type: 'search',
            placeholder: 'Filter sessions or projects…',
            value: q,
            onChange: (e) => queryAtom.set(e.target.value),
            className: 'w-full rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-subtle) px-2.5 py-1 text-xs text-(--ui-text-primary) outline-none placeholder:text-(--ui-text-quaternary) focus:border-(--ui-accent)'
          })
        ]
      }),

      // Content View
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-hidden flex flex-col',
        children: view === 'projects' ? jsx(ProjectBrowser, {}) : jsx(SessionBrowser, {})
      })
    ]
  })
}

// ── Plugin Registration ──────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Sidebar Navigator',
  description: 'Uncapped project session browser with inner scrolling and instant search.',
  defaultEnabled: true,

  register(ctx) {
    // 1. Layout Pane: Can be docked on the left rail or stacked alongside sessions
    ctx.register({
      id: 'navigator-pane',
      area: 'panes',
      title: 'Navigator',
      order: 15,
      data: { placement: 'left', width: '280px' },
      render: () => jsx(NavigatorShell, {})
    })

    // 2. Full-Page Route: Reachable via /navigator
    ctx.register({
      id: 'navigator-page',
      area: ROUTES_AREA,
      data: { path: '/navigator' },
      render: () => jsx(NavigatorShell, {})
    })

    // 3. Sidebar Nav Item: Quick navigation icon in the left toolbar
    ctx.register({
      id: 'navigator-nav',
      area: SIDEBAR_NAV_AREA,
      data: {
        path: '/navigator',
        label: 'Navigator',
        codicon: 'list-tree'
      }
    })

    // 4. Command Palette Action (Cmd/Ctrl + K)
    ctx.register({
      id: 'palette-open-navigator',
      area: PALETTE_AREA,
      data: {
        id: 'navigator.open',
        label: 'Sidebar Navigator: Open All Projects & Sessions',
        keywords: ['sidebar', 'projects', 'sessions', 'all', 'navigator', 'search'],
        action: 'navigator.open',
        run: () => {
          host.navigate('/navigator')
        }
      }
    })
  }
}
