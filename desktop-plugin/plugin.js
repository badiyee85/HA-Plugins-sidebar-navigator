/**
 * HA-Plugins-sidebar-navigator — Full-Power Sidebar Navigator for Hermes Desktop.
 *
 * Provides an uncapped, inner-scrolling, searchable project & session browser.
 * Bypasses the default 3-session sidebar overview limit.
 *
 * Loaded uncompiled by Hermes Desktop via @hermes/plugin-sdk.
 */

import {
  KEYBINDS_AREA,
  PALETTE_AREA,
  SIDEBAR_NAV_AREA,
  ROUTES_AREA,
  atom,
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

function SessionRow({ session, focused }) {
  const isCurrent = focused || session.id === focusAtom.get()
  const tokenStr = formatTokens((session.input_tokens || 0) + (session.output_tokens || 0))
  const ageStr = timeAgo(session.started_at)
  const meta = [tokenStr !== '0' ? tokenStr : null, ageStr].filter(Boolean).join(' · ')

  return jsxs('button', {
    type: 'button',
    className: isCurrent ? rowBtnActive : rowBtn,
    onClick: () => host.navigate(sessionRoute(session.id)),
    title: session.title || session.preview || session.id,
    children: [
      jsx('span', {
        className: 'inline-block h-2 w-2 shrink-0 rounded-full bg-(--ui-accent) opacity-80 group-hover:opacity-100'
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
          jsx(SessionRow, { session: s, focused: s.id === currentId }, s.id)
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

function ProjectCard({ project, currentId, filterQuery }) {
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
            : jsx(IconOr, { icon: 'Folder', glyph: '📁' }),
          jsx('span', {
            className: 'min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider text-(--ui-text-primary)',
            children: project.label || project.name || project.id
          }),
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
                    jsx(SessionRow, { session: s, focused: s.id === currentId }, `${project.id}/${s.id}`)
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
    .filter((p) => !p.isNoProject)
    .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))

  if (projects.length === 0) {
    return jsx('div', { className: `${hintStyle} p-3`, children: 'No projects registered on this profile.' })
  }

  return jsx('div', {
    className: 'min-h-0 flex-1 overflow-y-auto px-2 py-1.5',
    children: projects.map((p) =>
      jsx(ProjectCard, { project: p, currentId, filterQuery: q }, p.id)
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
