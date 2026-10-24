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
  PALETTE_AREA,
  PROFILE_SWATCHES,
  profileColor as sdkProfileColor,
  profileColorSoft as sdkProfileColorSoft,
  ROUTES_AREA,
  SessionStatusDot,
  SIDEBAR_NAV_AREA,
  atom,
  haptic,
  host,
  icons,
  queryClient,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export {
  ProfileGlyph,
  SessionTagBadges,
  TagDialog,
  TagFilterBar,
  TagPill,
  WhereDialog,
  SessionRow,
  ProjectCard,
  NavigatorShell,
  BulkBar,
  BulkTagDialog,
  SelectBox,
  whereStateAtom,
  whereOpenAtom,
  openWhereDialog,
  closeWhereDialog,
  activeRouteFrom,
  addSessionTag,
  addToSelection,
  BULK_ACTIONS,
  branchSession,
  fetchSessionMessages,
  renameSession,
  withStoredSession,
  SavedViewsBar,
  SaveViewDialog,
  VIEWS_MAX,
  VIEW_NAME_MAX,
  applyView,
  browseStateAtom,
  deleteView,
  getSavedViews,
  normalizeViewName,
  normalizeViewQuery,
  queryAtom,
  sanitizeViews,
  saveView,
  summarizeSaveView,
  suggestViewName,
  viewAtom,
  viewIsActive,
  ShowMoreButton,
  SessionBrowser,
  ProjectBrowser,
  closeNavigatorPage,
  fetchProjectList,
  prefetchTimeline,
  sessionListQuery,
  ROUTE_CATALOG_TTL_MS,
  ROW_PAGE_SIZE,
  invalidateTagsCache,
  tagsMapFor,
  copyText,
  isActiveRoute,
  isSessionPinned,
  getSessionColorOverride,
  setSessionColorOverride,
  setPluginContext,
  setPluginStorage,
  toggleSessionPin,
  toggleSessionUnread,
  focusAtom,
  bulkMutate,
  bulkTag,
  partitionBusy,
  removeFromSelection,
  runBulk,
  selectionAtom,
  selectionFor,
  summarizeBulk,
  summarizeTag,
  toggleSelection,
  createSessionInProject,
  describeBrowseError,
  duplicateProfileNames,
  focusedOnRoute,
  getAllRouteTags,
  getSessionTags,
  matchesSessionFilter,
  normalizeRoute,
  normalizeRoutes,
  normalizeTag,
  openSessionForRoute,
  parseSessionQuery,
  profileColor,
  profileColorSoft,
  queryKey,
  readSessionTagsMap,
  reconcileBrowseState,
  reconcileRoute,
  removeSessionTag,
  requestForRoute,
  resolveProjectCwd,
  resolveSessionProfile,
  routeKey,
  routeLabel,
  rowKey,
  setSessionTags,
  shouldShowProfileBadge,
  storageKey,
  tagColor,
  tagColorSoft,
  tagsRevisionAtom,
  toggleSessionTag,
  toggleTagInQuery,
  writeSessionTagsMap
}

const ID = 'ha-sidebar-navigator'
const LEGACY_ACTIVE_CONNECTION = '__legacy_active__'
const LEGACY_ROUTE_MODE = 'legacy'
const ROUTE_CACHE_TTL_MS = 5000
// How long reads reuse the route catalog. `host.profileRoutes()` is not cheap on a
// remote Desktop: it refetches /api/profiles and has Electron enumerate every
// registry source (the slowest source sets the time). Navigator open, Refresh and
// every action re-resolve fresh; a read that fails re-checks its route once.
const ROUTE_CATALOG_TTL_MS = 5 * 60 * 1000
const ROUTE_UNAVAILABLE = 'route_unavailable'

function text(value) {
  return String(value ?? '').trim()
}

function normalizeRoute(route) {
  if (!route || typeof route !== 'object') return null

  const connectionId = text(route.connectionId)
  const mode = text(route.mode)
  const profile = text(route.profile)
  const targetProfile = text(route.targetProfile)

  if (!connectionId || !profile || !targetProfile) return null
  if (connectionId === LEGACY_ACTIVE_CONNECTION && mode === LEGACY_ROUTE_MODE) {
    return { connectionId, mode, profile, targetProfile }
  }
  if (!['local', 'remote'].includes(mode)) return null

  return { connectionId, mode, profile, targetProfile }
}

function legacyActiveRoute(profile) {
  const name = text(profile)
  return name
    ? { connectionId: LEGACY_ACTIVE_CONNECTION, mode: LEGACY_ROUTE_MODE, profile: name, targetProfile: name }
    : null
}

function isLegacyRoute(route) {
  const normalized = normalizeRoute(route)
  return Boolean(normalized && normalized.connectionId === LEGACY_ACTIVE_CONNECTION && normalized.mode === LEGACY_ROUTE_MODE)
}

function isLocalRoute(route) {
  const normalized = normalizeRoute(route)
  if (!normalized) return false
  return normalized.mode === 'local' || isLegacyRoute(normalized)
}

function routeKey(route) {
  const normalized = normalizeRoute(route)
  return normalized ? `${normalized.connectionId}\u0000${normalized.profile}` : ''
}

function sameRoute(left, right) {
  const a = normalizeRoute(left)
  const b = normalizeRoute(right)
  return Boolean(
    a && b && routeKey(a) === routeKey(b) && a.mode === b.mode && a.targetProfile === b.targetProfile
  )
}

function normalizeRoutes(routes) {
  const unique = new Map()
  for (const candidate of Array.isArray(routes) ? routes : []) {
    const route = normalizeRoute(candidate)
    if (!route) continue

    const key = routeKey(route)
    const previous = unique.get(key)
    if (!previous) {
      unique.set(key, route)
    } else if (!sameRoute(previous, route)) {
      // A remapped duplicate identity is unsafe to browse or mutate. Quarantine
      // it rather than silently choosing whichever descriptor arrived last.
      unique.delete(key)
    }
  }
  return [...unique.values()]
}

function reconcileRoute(selected, routes) {
  return normalizeRoutes(routes).find(candidate => sameRoute(candidate, selected)) || null
}

function activeRouteFrom(routes, connectionId, profile) {
  const normalizedConnectionId = text(connectionId)
  const normalizedProfile = text(profile)
  const available = normalizeRoutes(routes)
  const exact = available.find(route =>
    route.connectionId === normalizedConnectionId && route.profile === normalizedProfile
  )
  return exact || (!normalizedConnectionId ? legacyActiveRoute(normalizedProfile) : null)
}

function reconcileBrowseState(state, routes, connectionId, profile) {
  const available = normalizeRoutes(routes)
  const active = activeRouteFrom(available, connectionId, profile)
  const selected = state?.selected ? reconcileRoute(state.selected, available) : null
  if (state?.manual) {
    return selected
      ? { manual: true, selected, unavailable: null }
      : { manual: true, selected: null, unavailable: normalizeRoute(state.selected) }
  }
  return { manual: false, selected: active, unavailable: null }
}

function duplicateProfileNames(routes) {
  const counts = new Map()
  for (const route of normalizeRoutes(routes)) {
    if (isLegacyRoute(route)) continue
    counts.set(route.profile, (counts.get(route.profile) || 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([profile]) => profile))
}

function routeLabel(route, duplicates = new Set()) {
  const normalized = normalizeRoute(route)
  if (!normalized) return 'Unavailable'
  return duplicates.has(normalized.profile)
    ? `${normalized.profile} · ${normalized.connectionId}`
    : normalized.profile
}

const BROWSE_ERROR_MAX_CHARS = 240

// Turn a failed profile read into one honest, actionable sidebar line. The
// backend already explains itself (e.g. a profile whose session store has not
// been reconciled yet); a generic "unavailable" hides the fix.
function describeBrowseError(error, route, what = 'sessions') {
  const reason = text(
    typeof error === 'string' ? error : error?.message || error?.detail
  ).slice(0, BROWSE_ERROR_MAX_CHARS)
  const profile = text(normalizeRoute(route)?.profile)
  const subject = profile ? `${what} for profile “${profile}”` : what
  return reason ? `Couldn’t load ${subject}: ${reason}` : `Couldn’t load ${subject}. Try refresh.`
}

function queryKey(resource, route, extra = []) {
  const normalized = normalizeRoute(route)
  return normalized
    ? [ID, resource, normalized.connectionId, normalized.profile, normalized.mode, normalized.targetProfile, ...extra]
    : [ID, resource, 'unavailable', ...extra]
}

function rowKey(route, sessionId) {
  return `${routeKey(route) || 'unavailable'}\u0000${text(sessionId)}`
}

function storageKey(base, route) {
  const normalized = normalizeRoute(route)
  return normalized
    ? `${base}.v2.${encodeURIComponent(normalized.connectionId)}.${encodeURIComponent(normalized.profile)}`
    : ''
}

function focusedOnRoute(owner, route, focusedStoredId, sessionId) {
  const normalized = normalizeRoute(route)
  if (!normalized || text(focusedStoredId) !== text(sessionId)) return false
  if (isLegacyRoute(normalized)) {
    return text(owner?.profile) === normalized.profile && !text(owner?.connectionId)
  }
  return Boolean(
    text(owner?.connectionId) === normalized.connectionId &&
      text(owner?.profile) === normalized.profile
  )
}

function ownerFrom(transportHost = host) {
  const state = transportHost?.state || {}
  const read = value => value && typeof value.get === 'function' ? value.get() : value
  const connectionId = text(read(state.connectionId))
  const profile = text(read(state.profile))
  return profile ? { connectionId: connectionId || null, profile } : null
}

function activeOwner() {
  return ownerFrom(host)
}

let routeCatalogHost = null
let routeCatalog = []
let routeCatalogExpiresAt = 0
let routeCatalogPromise = null
let routeCatalogGeneration = 0

function clearRouteCatalogCache() {
  routeCatalogGeneration += 1
  routeCatalogHost = null
  routeCatalog = []
  routeCatalogExpiresAt = 0
  routeCatalogPromise = null
}

async function currentRoutes(transportHost = host, fresh = false) {
  if (typeof transportHost?.profileRoutes !== 'function') return null

  const now = Date.now()
  if (!fresh && routeCatalogHost === transportHost && routeCatalogExpiresAt > now) {
    return routeCatalog
  }
  if (!fresh && routeCatalogPromise && routeCatalogHost === transportHost) {
    return routeCatalogPromise
  }

  const generation = ++routeCatalogGeneration
  const pending = Promise.resolve(transportHost.profileRoutes())
    .then(raw => {
      const routes = normalizeRoutes(raw)
      if (generation === routeCatalogGeneration && routeCatalogHost === transportHost) {
        routeCatalog = routes
        routeCatalogExpiresAt = Date.now() + ROUTE_CATALOG_TTL_MS
      }
      return routes
    })
    .finally(() => {
      if (routeCatalogPromise === pending) routeCatalogPromise = null
    })

  routeCatalogHost = transportHost
  routeCatalogPromise = pending
  return pending
}

async function routeForRequest(route, transportHost = host, fresh = false) {
  const normalized = normalizeRoute(route)
  if (!normalized) throw new Error('Profile route unavailable')
  if (isLegacyRoute(normalized)) return normalized

  const routes = await currentRoutes(transportHost, fresh)
  if (routes) {
    const current = reconcileRoute(normalized, routes)
    if (!current) {
      const gone = new Error('The selected profile route is no longer available. Refresh Navigator.')
      gone.code = ROUTE_UNAVAILABLE
      throw gone
    }
    return current
  }
  return normalized
}

async function requestForRoute(route, method, params = {}, transportHost = host, owner = undefined, options = {}) {
  const fresh = Boolean(options.fresh)
  const normalized = await routeForRequest(route, transportHost, fresh)
  try {
    return await dispatchForRoute(normalized, method, params, transportHost, owner)
  } catch (error) {
    // The catalog is reused for minutes, so a failure may mean the route itself
    // went away. Re-check it once (which also refreshes the cache for the next
    // call): a vanished route gets the clear "no longer available" error. The call
    // is never re-sent, so a write cannot run twice.
    if (!fresh && !isLegacyRoute(normalized)) {
      try {
        await routeForRequest(route, transportHost, true)
      } catch (recheck) {
        if (recheck?.code === ROUTE_UNAVAILABLE) throw recheck
      }
    }
    throw error
  }
}

function dispatchForRoute(normalized, method, params, transportHost, owner) {
  const currentOwner = owner || ownerFrom(transportHost)

  if (isLegacyRoute(normalized)) {
    if (text(currentOwner?.profile) !== normalized.profile || typeof transportHost.request !== 'function') {
      throw new Error('This Hermes Desktop can only browse the active profile. Update Desktop for profile browsing.')
    }
    return transportHost.request(method, params)
  }

  if (typeof transportHost.requestProfile === 'function') {
    return transportHost.requestProfile(normalized, method, params)
  }
  if (
    currentOwner?.connectionId === normalized.connectionId &&
    text(currentOwner?.profile) === normalized.profile &&
    typeof transportHost.request === 'function'
  ) {
    return transportHost.request(method, params)
  }
  throw new Error('This Hermes Desktop can only browse the active profile. Update Desktop for profile browsing.')
}

async function discoverRoutes() {
  if (typeof host.profileRoutes !== 'function' || typeof host.requestProfile !== 'function') {
    return null
  }
  return currentRoutes(host, true)
}

async function openSessionForRoute(route, sessionId, intent = 'in-place', sessionHost = host) {
  const normalized = await routeForRequest(route, sessionHost, true)
  if (typeof sessionHost.openSession !== 'function') {
    throw new Error('Profile-aware session opening is unavailable on this Hermes Desktop build.')
  }

  if (isLegacyRoute(normalized)) {
    return sessionHost.openSession(sessionId, {
      profile: normalized.profile,
      intent,
      keepAllProfilesScope: false
    })
  }

  // The current Desktop SDK's explicit-route branch enables its aggregate
  // sidebar scope whenever `options.route` is present. That is incompatible
  // with Navigator v1, which deliberately has no aggregate scope. Use the
  // profile-only opening contract after explicitly activating the owner; the
  // SDK then follows its normal profile switch path without taking the
  // explicit-route branch. This is safe only when the activation door exists.
  if (typeof sessionHost.ensureAgent !== 'function') {
    throw new Error('Profile-aware session opening without aggregate scope is unavailable on this Hermes Desktop build.')
  }

  await sessionHost.ensureAgent(normalized.connectionId, normalized.profile)
  return sessionHost.openSession(sessionId, {
    profile: normalized.profile,
    intent,
    keepAllProfilesScope: false
  })
}
const SESSIONS_LIMIT = 500
const TREE_PREVIEW_LIMIT = 100
const PROJECT_SESSION_LIMIT = 2000
// Rows mounted at once in the Timeline / an expanded project; "Show more" adds a page.
const ROW_PAGE_SIZE = 100
// The project list some views need (Move menu, bulk move) never uses session previews.
const PROJECT_LIST_PARAMS = { preview_limit: 1 }

function fetchProjectList(route) {
  return requestForRoute(route, 'projects.tree', PROJECT_LIST_PARAMS)
}

// One definition for the Timeline's session list, shared by the Timeline and the
// prefetch that warms it when the Navigator opens (same key, same fetch).
function sessionListQuery(route) {
  return {
    queryKey: queryKey('sessions', route),
    queryFn: () => requestForRoute(route, 'session.list', { limit: SESSIONS_LIMIT }),
    enabled: Boolean(route),
    refetchInterval: 15000,
    staleTime: 5000
  }
}

// Warm the Timeline in the background so switching to it shows rows at once.
// A one-off fetch: it adds no poll while the user stays on Projects.
function prefetchTimeline(route, client = queryClient) {
  if (!route || typeof client?.prefetchQuery !== 'function') return
  const { queryKey: key, queryFn, staleTime } = sessionListQuery(route)
  void Promise.resolve(client.prefetchQuery({ queryKey: key, queryFn, staleTime })).catch(() => {})
}

const viewAtom = atom('projects')
const queryAtom = atom('')
const browseStateAtom = atom({ manual: false, selected: null, unavailable: null })

// WhereDialog state atom: { open: boolean, route: any }
const whereStateAtom = atom({ open: false, route: null })

// Derived whereOpenAtom convenience
const whereOpenAtom = {
  get: () => Boolean(whereStateAtom.get()?.open),
  set: (val) => {
    const cur = whereStateAtom.get() || { open: false, route: null }
    whereStateAtom.set({ ...cur, open: Boolean(val) })
  }
}

function openWhereDialog(route = null) {
  whereStateAtom.set({ open: true, route: route ?? null })
}

function closeWhereDialog() {
  whereStateAtom.set({ open: false, route: null })
}

function readAtom(value) {
  return value && typeof value.get === 'function' ? value.get() : value
}

function focusedOwner() {
  if (!host.state.focusedSessionOwner) return activeOwner()
  // A present-but-null owner is deliberately ambiguous/unresolved in the SDK;
  // do not reinterpret it as the active route when duplicate ids may exist.
  const owner = readAtom(host.state.focusedSessionOwner)
  return owner && text(owner.profile) ? owner : null
}

function invalidateRoute(route) {
  queryClient.invalidateQueries({ queryKey: queryKey('sessions', route) })
  queryClient.invalidateQueries({ queryKey: queryKey('projects-tree', route) })
  queryClient.invalidateQueries({ queryKey: queryKey('projects-list', route) })
  queryClient.invalidateQueries({ queryKey: queryKey('project-sessions', route) })
}

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
  'group relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] ' +
  'text-(--ui-text-primary) transition-colors hover:bg-(--chrome-action-hover)'
const rowBtnActive =
  rowBtn + ' bg-(--chrome-action-hover) font-medium border-l-2 border-(--ui-accent)'
const chipBtn =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-(--ui-stroke-secondary) ' +
  'text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) ' +
  'hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
const segActive =
  'shrink-0 rounded-md px-2.5 py-1 text-[0.75rem] font-medium bg-(--ui-accent) text-(--ui-bg-primary)'
const segIdle =
  'shrink-0 rounded-md px-2.5 py-1 text-[0.75rem] font-medium text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'

function IconOr({ icon, glyph }) {
  const Cmp = icons?.[icon]
  return Cmp ? jsx(Cmp, { className: 'h-3.5 w-3.5 shrink-0' }) : jsx('span', { className: 'text-xs shrink-0', children: glyph })
}

// ── Session Context Menu Actions & Storage Helpers ──────────────────────────

// Navigator state (pins, colours, unread marks, tags) lives in the plugin's own
// namespaced store, ctx.storage, and nowhere else. The real sidebar's pin and
// colour are only ever changed through the public host.sessions verbs, and only
// for the profile the Desktop window is actually showing.

function createMemoryStorage() {
  const map = new Map()
  return {
    get: (key, fallback) => (map.has(key) ? JSON.parse(map.get(key)) : fallback),
    set: (key, value) => { map.set(key, JSON.stringify(value)) },
    remove: (key) => { map.delete(key) }
  }
}

// Wraps a storage with a read-through cache: a row asks for its pin / unread /
// colour / tags on every render, and ctx.storage parses JSON on every get, so
// 500 rows meant thousands of parses. Writes update the cache; clear() drops it
// (another window changed the stored value).
function withReadCache(storage) {
  const cache = new Map()
  return {
    get(key, fallback) {
      if (!cache.has(key)) cache.set(key, storage.get(key, null))
      const value = cache.get(key)
      return value === null || value === undefined ? fallback : value
    },
    set(key, value) {
      storage.set(key, value)
      cache.set(key, value)
    },
    remove(key) {
      storage.remove(key)
      cache.set(key, null)
    },
    clear() {
      cache.clear()
    }
  }
}

// Replaced by ctx.storage in register(). The in-memory default keeps helpers
// usable before registration and in tests.
let pluginStorage = withReadCache(createMemoryStorage())
let pluginOs = null
// Routes whose legacy localStorage tags were already looked for this session.
const legacyTagsChecked = new Set()

function setPluginContext(ctx) {
  if (ctx?.storage) {
    pluginStorage = withReadCache(ctx.storage)
    legacyTagsChecked.clear()
    tagsMapCache.clear()
  }
  pluginOs = ctx?.os ?? null
}

function setPluginStorage(storage) {
  pluginStorage = withReadCache(storage || createMemoryStorage())
  legacyTagsChecked.clear()
  tagsMapCache.clear()
}

// Is this route the profile the Desktop window is showing right now? Only then
// can host.sessions.* address its sidebar rows.
function isActiveRoute(route) {
  const normalized = normalizeRoute(route)
  const owner = activeOwner()
  if (!normalized || !owner) return false
  if (isLegacyRoute(normalized)) return normalized.profile === text(owner.profile)
  return normalized.connectionId === text(owner.connectionId) && normalized.profile === text(owner.profile)
}

async function copyText(value) {
  try {
    if (pluginOs?.writeClipboard && (await pluginOs.writeClipboard(value))) return true
  } catch {
    // fall through to the web clipboard
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // reported by the caller
  }
  return false
}

async function copyWithToast(value, label) {
  const ok = await copyText(value)
  if (ok) host.notify({ kind: 'success', message: `${label} copied to clipboard` })
  else host.notifyError?.(new Error('Clipboard is unavailable'), `Failed to copy ${label.toLowerCase()}`)
  return ok
}

function readIdList(route, base) {
  const key = storageKey(base, route)
  if (!key) return []
  const list = pluginStorage.get(key, [])
  return Array.isArray(list) ? list.filter(id => typeof id === 'string') : [] // filter() copies
}

function writeIdList(route, base, list) {
  const key = storageKey(base, route)
  if (!key) return false
  if (list.length) pluginStorage.set(key, list)
  else pluginStorage.remove(key)
  return true
}

function isSessionPinned(sessionId, session, route) {
  if (session?.pinned === true) return true
  return readIdList(route, 'pins').includes(sessionId)
}

function readColorMap(route) {
  const key = storageKey('colors', route)
  const map = key ? pluginStorage.get(key, {}) : {}
  return map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {}
}

function getSessionColorOverride(sessionId, route) {
  return readColorMap(route)[sessionId] || null
}

function setSessionColorOverride(sessionId, color, route) {
  const key = storageKey('colors', route)
  if (!key) return
  const map = readColorMap(route)
  if (color) map[sessionId] = color
  else delete map[sessionId]
  if (Object.keys(map).length) pluginStorage.set(key, map)
  else pluginStorage.remove(key)
  if (isActiveRoute(route)) host.sessions?.setColor?.(sessionId, color || null)
}

async function toggleSessionPin(sessionId, currentlyPinned, route) {
  const list = readIdList(route, 'pins')
  const next = currentlyPinned
    ? list.filter(id => id !== sessionId)
    : [sessionId, ...list.filter(id => id !== sessionId)]
  if (!writeIdList(route, 'pins', next)) throw new Error('Navigator storage is unavailable.')
  if (isActiveRoute(route)) host.sessions?.pin?.(sessionId, !currentlyPinned)
  return !currentlyPinned
}

async function toggleSessionUnread(sessionId, currentlyUnread, route) {
  const list = readIdList(route, 'unread')
  const next = currentlyUnread
    ? list.filter(id => id !== sessionId)
    : [sessionId, ...list.filter(id => id !== sessionId)]
  if (!writeIdList(route, 'unread', next)) throw new Error('Navigator storage is unavailable.')
  return !currentlyUnread
}

// ─── Session Tags Storage & Utilities ────────────────────────────────────────

const TAGS_STORAGE_BASE = 'sessionTags'
// Pre-0.8.1 builds kept tags in the page's localStorage; read once, then removed.
const LEGACY_TAGS_STORAGE_BASE = 'hermes.desktop.sessionTags'
const TAG_MAX_LEN = 32
const TAGS_PER_SESSION_MAX = 16

const tagsRevisionAtom = atom(0)
let tagsRevisionCounter = 0
function bumpTagsRevision() {
  tagsRevisionCounter += 1
  tagsRevisionAtom.set(tagsRevisionCounter)
}

function normalizeTag(input) {
  if (input == null) return ''
  return String(input)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, TAG_MAX_LEN)
    .replace(/-+$/, '')
}

function djb2Hash(str) {
  let hash = 5381
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash
}

function tagColor(tag) {
  const t = normalizeTag(tag)
  if (!t) return 'var(--ui-text-quaternary)'
  const hue = djb2Hash(t) % 360
  return `hsl(${hue} 68% 58%)`
}

function tagColorSoft(color, percent = 16) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

function tagsKey(route) {
  return storageKey(TAGS_STORAGE_BASE, route)
}

function sanitizeTagList(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const item of list) {
    const n = normalizeTag(item)
    if (n && !seen.has(n)) {
      seen.add(n)
      out.push(n)
      if (out.length >= TAGS_PER_SESSION_MAX) break
    }
  }
  return out
}

function cleanTagsMap(raw) {
  const cleanMap = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, list] of Object.entries(raw)) {
      const clean = sanitizeTagList(list)
      if (clean.length) cleanMap[id] = clean
    }
  }
  return cleanMap
}

// One-shot import of tags a pre-0.8.1 build saved in localStorage: move them into
// ctx.storage, then delete the old entry so this never runs twice.
function migrateLegacyTags(route, key) {
  const legacyKey = storageKey(LEGACY_TAGS_STORAGE_BASE, route)
  if (!legacyKey || typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage?.getItem(legacyKey)
    if (!raw) return {}
    const migrated = cleanTagsMap(JSON.parse(raw))
    if (Object.keys(migrated).length) pluginStorage.set(key, migrated)
    window.localStorage.removeItem(legacyKey)
    return migrated
  } catch {
    return {}
  }
}

// Parsed + sanitised tags per route. Rows ask for their tags on every render, so
// reading ctx.storage (a JSON.parse of the whole map) per row made a 500-row
// Timeline quadratic. The cache is dropped on every write and whenever another
// window changes the stored value; treat what tagsMapFor returns as read-only.
const tagsMapCache = new Map()
const NO_TAGS = Object.freeze({})

function invalidateTagsCache() {
  tagsMapCache.clear()
  pluginStorage.clear()
}

function tagsMapFor(route) {
  const key = tagsKey(route)
  if (!key) return NO_TAGS
  let map = tagsMapCache.get(key)
  if (!map) {
    const stored = pluginStorage.get(key, null)
    if (stored !== null) map = cleanTagsMap(stored)
    else if (legacyTagsChecked.has(key)) map = {}
    else {
      legacyTagsChecked.add(key)
      map = migrateLegacyTags(route, key)
    }
    tagsMapCache.set(key, map)
  }
  return map
}

// A private copy for callers that edit the map before writing it back.
function readSessionTagsMap(route) {
  return { ...tagsMapFor(route) }
}

function writeSessionTagsMap(route, map) {
  const key = tagsKey(route)
  if (!key) return
  const cleanMap = cleanTagsMap(map)
  if (Object.keys(cleanMap).length) pluginStorage.set(key, cleanMap)
  else pluginStorage.remove(key)
  tagsMapCache.set(key, cleanMap)
  bumpTagsRevision()
}

function getSessionTags(sessionId, route) {
  if (!sessionId) return []
  return tagsMapFor(route)[sessionId] || []
}

function setSessionTags(sessionId, tags, route) {
  if (!sessionId) return
  const map = readSessionTagsMap(route)
  const clean = sanitizeTagList(tags)
  if (clean.length === 0) {
    delete map[sessionId]
  } else {
    map[sessionId] = clean
  }
  writeSessionTagsMap(route, map)
}

function addSessionTag(sessionId, tag, route) {
  const n = normalizeTag(tag)
  if (!sessionId || !n) return false
  const cur = getSessionTags(sessionId, route)
  if (cur.includes(n)) return true
  if (cur.length >= TAGS_PER_SESSION_MAX) return false
  setSessionTags(sessionId, [...cur, n], route)
  return true
}

function removeSessionTag(sessionId, tag, route) {
  const n = normalizeTag(tag)
  if (!sessionId || !n) return
  const cur = getSessionTags(sessionId, route)
  if (!cur.includes(n)) return
  setSessionTags(sessionId, cur.filter(t => t !== n), route)
}

function toggleSessionTag(sessionId, tag, route) {
  const n = normalizeTag(tag)
  if (!sessionId || !n) return
  const cur = getSessionTags(sessionId, route)
  if (cur.includes(n)) {
    removeSessionTag(sessionId, n, route)
  } else {
    addSessionTag(sessionId, n, route)
  }
}

function getAllRouteTags(route) {
  const map = tagsMapFor(route)
  const s = new Set()
  for (const tags of Object.values(map)) {
    for (const t of tags) s.add(t)
  }
  return [...s].sort()
}

// ─── Query Parsing & Filter Matching ─────────────────────────────────────────

function parseSessionQuery(query) {
  const q = String(query || '').trim()
  if (!q) return { tags: [], text: [] }
  const tags = []
  const text = []
  const parts = q.split(/\s+/)
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('#')) {
      const t = normalizeTag(part.slice(1))
      if (t && !tags.includes(t)) tags.push(t)
    } else {
      text.push(part.toLowerCase())
    }
  }
  return { tags, text }
}

function matchesSessionFilter(session, query, tags, legacyMatch) {
  const q = String(query || '').trim()
  if (!q) return true
  const { tags: reqTags, text } = parseSessionQuery(q)

  if (reqTags.length > 0) {
    const sessionTags = tags || []
    for (const t of reqTags) {
      if (!sessionTags.includes(t)) return false
    }
  }

  if (text.length > 0) {
    if (typeof legacyMatch === 'function') {
      return legacyMatch(session, text.join(' '))
    }
    const searchable = `${session?.title || ''} ${session?.preview || ''} ${session?.id || ''}`.toLowerCase()
    for (const term of text) {
      if (!searchable.includes(term)) return false
    }
  }

  return true
}

function toggleTagInQuery(query, tag) {
  const n = normalizeTag(tag)
  if (!n) return query || ''
  const { tags, text } = parseSessionQuery(query || '')
  const idx = tags.indexOf(n)
  if (idx >= 0) {
    tags.splice(idx, 1)
  } else {
    tags.push(n)
  }
  const parts = [...text, ...tags.map(t => `#${t}`)]
  return parts.join(' ')
}

// ─── Saved Views ─────────────────────────────────────────────────────────────
//
// A saved view is a named search: the filter text (with any #tags) plus the
// Projects/Timeline mode it was saved in. Stored per profile route in
// ctx.storage because tags are per route, so a view's #tags only mean something
// on the profile that owns them.

const VIEWS_MAX = 20
const VIEW_NAME_MAX = 32

const viewsRevisionAtom = atom(0)
let viewsRevisionCounter = 0
function bumpViewsRevision() {
  viewsRevisionCounter += 1
  viewsRevisionAtom.set(viewsRevisionCounter)
}

function normalizeViewName(input) {
  return String(input ?? '').replace(/\s+/g, ' ').trim().slice(0, VIEW_NAME_MAX).trim()
}

function normalizeViewQuery(input) {
  return String(input ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeViewMode(mode) {
  return mode === 'sessions' ? 'sessions' : 'projects'
}

function suggestViewName(query) {
  return normalizeViewName(normalizeViewQuery(query).replace(/#/g, ''))
}

// Storage is user-editable and cross-window, so never trust its shape.
function sanitizeViews(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const views = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const name = normalizeViewName(raw.name)
    const query = normalizeViewQuery(raw.query)
    const id = typeof raw.id === 'string' ? raw.id : ''
    if (!name || !query || !id || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    views.push({ id, name, query, mode: normalizeViewMode(raw.mode) })
    if (views.length >= VIEWS_MAX) break
  }
  return views
}

function viewsKey(route) {
  return storageKey('views', route)
}

function getSavedViews(route) {
  const key = viewsKey(route)
  return key ? sanitizeViews(pluginStorage.get(key, [])) : []
}

function writeSavedViews(route, views) {
  const key = viewsKey(route)
  if (!key) return false
  if (views.length) pluginStorage.set(key, views)
  else pluginStorage.remove(key)
  bumpViewsRevision()
  return true
}

let viewIdCounter = 0
function newViewId() {
  viewIdCounter += 1
  return `v${Date.now().toString(36)}${viewIdCounter.toString(36)}`
}

// Saving under an existing name (any case) updates that view in place, so
// "re-save to change what it filters" works without a separate edit flow.
function saveView(route, { name, query, mode } = {}) {
  const cleanName = normalizeViewName(name)
  const cleanQuery = normalizeViewQuery(query)
  if (!viewsKey(route)) return { ok: false, reason: 'unavailable' }
  if (!cleanName) return { ok: false, reason: 'name' }
  if (!cleanQuery) return { ok: false, reason: 'query' }

  const views = getSavedViews(route)
  const existing = views.findIndex(v => v.name.toLowerCase() === cleanName.toLowerCase())
  const view = {
    id: existing >= 0 ? views[existing].id : newViewId(),
    name: cleanName,
    query: cleanQuery,
    mode: normalizeViewMode(mode)
  }
  if (existing >= 0) views[existing] = view
  else if (views.length >= VIEWS_MAX) return { ok: false, reason: 'limit' }
  else views.push(view)

  writeSavedViews(route, views)
  return { ok: true, view, replaced: existing >= 0 }
}

function deleteView(route, id) {
  const views = getSavedViews(route)
  const next = views.filter(v => v.id !== id)
  if (next.length === views.length) return false
  writeSavedViews(route, next)
  return true
}

function viewIsActive(view, query, mode) {
  return (
    normalizeViewQuery(query).toLowerCase() === view.query.toLowerCase() &&
    normalizeViewMode(mode) === view.mode
  )
}

function applyView(view) {
  queryAtom.set(view.query)
  setView(view.mode)
}

function summarizeSaveView(result, name) {
  if (result.ok) {
    return { kind: 'success', message: `${result.replaced ? 'Updated' : 'Saved'} view “${result.view.name}”` }
  }
  const reasons = {
    name: 'Give the view a name',
    query: 'Type a filter or pick a tag first',
    limit: `You can keep up to ${VIEWS_MAX} views. Delete one first`,
    unavailable: 'Views are unavailable for this profile'
  }
  return { kind: 'error', message: reasons[result.reason] || `Could not save “${normalizeViewName(name)}”` }
}

function SaveViewDialog({ open, onOpenChange, route, query, mode }) {
  const [name, setName] = useState(() => suggestViewName(query))
  const submit = () => {
    const result = saveView(route, { name, query, mode })
    host.notify(summarizeSaveView(result, name))
    if (result.ok) onOpenChange(false)
    return result
  }
  return jsx(Dialog, {
    open,
    onOpenChange,
    children: jsxs(DialogContent, {
      className: 'max-w-sm p-4',
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: 'Save view' }),
            jsx('p', {
              className: 'mt-0.5 text-xs text-(--ui-text-quaternary) break-words',
              children: `${normalizeViewMode(mode) === 'sessions' ? 'Timeline' : 'Projects'} · ${normalizeViewQuery(query)}`
            })
          ]
        }),
        jsx(Input, {
          autoFocus: true,
          placeholder: 'View name…',
          value: name,
          maxLength: VIEW_NAME_MAX,
          onChange: (e) => setName(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
              e.preventDefault()
              submit()
            }
          },
          className: 'mt-2 w-full text-xs'
        }),
        jsxs(DialogFooter, {
          className: 'mt-3 pt-2 border-t border-(--ui-stroke-secondary) flex justify-end gap-1.5',
          children: [
            jsx(Button, { type: 'button', variant: 'ghost', onClick: () => onOpenChange(false), children: 'Cancel' }),
            jsx(Button, { type: 'button', disabled: !normalizeViewName(name), onClick: submit, children: 'Save' })
          ]
        })
      ]
    })
  })
}

function SavedViewsBar({ route, className }) {
  useValue(viewsRevisionAtom)
  const query = useValue(queryAtom)
  const mode = useValue(viewAtom)
  const [saveOpen, setSaveOpen] = useState(false)
  if (!route) return null

  const views = getSavedViews(route)
  const canSave = Boolean(normalizeViewQuery(query)) && !views.some(v => viewIsActive(v, query, mode))
  if (!views.length && !canSave) return null

  return jsxs('div', {
    className: `flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar ${className || ''}`.trim(),
    role: 'group',
    'aria-label': 'Saved views',
    children: [
      jsx('span', {
        className: 'shrink-0 text-[0.625rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)',
        children: 'Views:'
      }),
      ...views.map(view => {
        const active = viewIsActive(view, query, mode)
        return jsxs('span', {
          key: view.id,
          className: `inline-flex shrink-0 items-center rounded-md border text-[0.6875rem] ${active ? 'border-(--ui-accent) bg-(--ui-accent)/15 text-(--ui-text-primary)' : 'border-(--ui-stroke-secondary) text-(--ui-text-secondary)'}`,
          children: [
            jsx('button', {
              type: 'button',
              className: 'rounded-l-md px-1.5 py-0.5 hover:bg-(--chrome-action-hover)',
              'aria-pressed': active,
              title: `${view.mode === 'sessions' ? 'Timeline' : 'Projects'} · ${view.query}`,
              onClick: () => applyView(view),
              children: view.name
            }),
            jsx('button', {
              type: 'button',
              className: 'rounded-r-md px-1 py-0.5 text-(--ui-text-quaternary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
              'aria-label': `Delete view ${view.name}`,
              title: 'Delete view',
              onClick: () => {
                deleteView(route, view.id)
                host.notify({ kind: 'info', message: `Deleted view “${view.name}”` })
              },
              children: '×'
            })
          ]
        })
      }),
      canSave ? jsxs('button', {
        type: 'button',
        className: 'inline-flex shrink-0 items-center gap-1 rounded-md border border-dashed border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.6875rem] text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
        title: 'Save the current filter as a view',
        onClick: () => setSaveOpen(true),
        children: [jsx(Codicon, { name: 'bookmark', size: '0.75rem' }), jsx('span', { children: 'Save view' })]
      }) : null,
      saveOpen ? jsx(SaveViewDialog, { open: saveOpen, onOpenChange: setSaveOpen, route, query, mode }) : null
    ]
  })
}

// ─── Tag UI Components ───────────────────────────────────────────────────────

function TagPill({ tag, active = false, onClick, onRemove, className, title }) {
  const n = normalizeTag(tag)
  if (!n) return null
  const color = tagColor(n)
  const bg = tagColorSoft(color, active ? 28 : 14)

  const handleClick = (e) => {
    if (onClick) {
      e.stopPropagation()
      onClick(n)
    }
  }

  return jsxs('span', {
    role: onClick ? 'button' : undefined,
    tabIndex: onClick ? 0 : undefined,
    onClick: handleClick,
    title: title || (active ? `Active tag filter: #${n}` : `Filter by #${n}`),
    className: `inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.2 text-[0.625rem] font-medium leading-none select-none transition-colors border ${
      active
        ? 'border-(--ui-accent) text-(--ui-text-primary)'
        : 'border-transparent text-(--ui-text-secondary) hover:text-(--ui-text-primary)'
    } ${onClick ? 'cursor-pointer hover:bg-(--chrome-action-hover)' : ''} ${className || ''}`.trim(),
    style: {
      backgroundColor: bg,
      borderColor: active ? color : undefined,
      color: active ? color : undefined
    },
    children: [
      jsx('span', {
        className: 'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        style: { backgroundColor: color }
      }),
      jsx('span', { className: 'truncate max-w-[80px]', children: n }),
      onRemove ? jsx('button', {
        type: 'button',
        title: `Remove tag ${n}`,
        className: 'hover:text-destructive p-0.5 leading-none',
        onClick: (e) => {
          e.stopPropagation()
          onRemove(n)
        },
        children: '×'
      }) : null
    ]
  })
}

function SessionTagBadges({ tags, maxVisible = 2, onTagClick, className }) {
  if (!tags || !tags.length) return null
  const visible = tags.slice(0, maxVisible)
  const hiddenCount = tags.length - visible.length

  return jsxs('div', {
    className: `inline-flex items-center gap-1 shrink-0 ${className || ''}`.trim(),
    children: [
      visible.map(t => jsx(TagPill, {
        tag: t,
        onClick: onTagClick
      }, t)),
      hiddenCount > 0 ? jsx('span', {
        className: 'text-[0.625rem] font-medium text-(--ui-text-quaternary) tabular-nums',
        title: tags.slice(maxVisible).join(', '),
        children: `+${hiddenCount}`
      }) : null
    ]
  })
}

function TagFilterBar({ route, className }) {
  useValue(tagsRevisionAtom)
  const currentQuery = useValue(queryAtom)
  const { tags: activeTags } = parseSessionQuery(currentQuery)
  const availableTags = getAllRouteTags(route)

  if (!availableTags || availableTags.length === 0) return null

  const handleTagToggle = (tag) => {
    const next = toggleTagInQuery(currentQuery, tag)
    queryAtom.set(next)
  }

  return jsxs('div', {
    className: `flex items-center gap-1 overflow-x-auto py-1 px-0.5 no-scrollbar ${className || ''}`.trim(),
    children: [
      jsx('span', {
        className: 'text-[0.625rem] font-semibold text-(--ui-text-quaternary) uppercase tracking-wider shrink-0 pl-1',
        children: 'Tags:'
      }),
      availableTags.map(t => jsx(TagPill, {
        tag: t,
        active: activeTags.includes(t),
        onClick: () => handleTagToggle(t)
      }, t))
    ]
  })
}

function TagDialog({ open, onOpenChange, session, route }) {
  useValue(tagsRevisionAtom)
  const [inputVal, setInputVal] = useState('')
  const sessionId = session?.id
  const assignedTags = open && sessionId ? getSessionTags(sessionId, route) : []
  const availableTags = open ? getAllRouteTags(route) : []

  const handleAdd = (tagToAdd) => {
    const n = normalizeTag(tagToAdd || inputVal)
    if (!n || !sessionId) return
    addSessionTag(sessionId, n, route)
    setInputVal('')
  }

  const handleRemove = (tagToRemove) => {
    if (!sessionId) return
    removeSessionTag(sessionId, tagToRemove, route)
  }

  const handleToggle = (tagToToggle) => {
    if (!sessionId) return
    toggleSessionTag(sessionId, tagToToggle, route)
  }

  return jsx(Dialog, {
    open,
    onOpenChange: (val) => {
      onOpenChange(val)
      if (!val) setInputVal('')
    },
    children: jsxs(DialogContent, {
      className: 'max-w-sm p-4',
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: 'Manage Tags' }),
            jsx('p', {
              className: 'text-xs text-(--ui-text-quaternary) mt-0.5 truncate',
              children: session?.title || session?.preview || session?.id || 'Session'
            })
          ]
        }),

        // Assigned Tags
        jsxs('div', {
          className: 'mt-3 mb-2',
          children: [
            jsx('div', {
              className: 'text-xs font-semibold text-(--ui-text-secondary) mb-1.5',
              children: 'Assigned Tags'
            }),
            assignedTags.length === 0
              ? jsx('p', { className: 'text-xs text-(--ui-text-quaternary) italic', children: 'No tags assigned yet.' })
              : jsx('div', {
                  className: 'flex flex-wrap gap-1.5',
                  children: assignedTags.map(t => jsx(TagPill, {
                    tag: t,
                    active: true,
                    onRemove: () => handleRemove(t)
                  }, t))
                })
          ]
        }),

        // Add Tag Input
        jsxs('div', {
          className: 'mt-3 flex gap-1.5',
          children: [
            jsx(Input, {
              autoFocus: true,
              placeholder: 'New tag name…',
              value: inputVal,
              onChange: (e) => setInputVal(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  handleAdd()
                }
              },
              className: 'flex-1 text-xs'
            }),
            jsx(Button, {
              type: 'button',
              disabled: !inputVal.trim(),
              onClick: () => handleAdd(),
              children: 'Add'
            })
          ]
        }),

        // Quick Pick from existing route tags
        availableTags.filter(t => !assignedTags.includes(t)).length > 0 ? jsxs('div', {
          className: 'mt-3 border-t border-(--ui-stroke-secondary) pt-2',
          children: [
            jsx('div', {
              className: 'text-[0.6875rem] font-medium text-(--ui-text-quaternary) mb-1',
              children: 'Quick add existing tag:'
            }),
            jsx('div', {
              className: 'flex flex-wrap gap-1 max-h-24 overflow-y-auto',
              children: availableTags.filter(t => !assignedTags.includes(t)).map(t => jsx('button', {
                type: 'button',
                key: t,
                onClick: () => handleAdd(t),
                className: 'rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-xs text-(--ui-text-secondary) hover:text-(--ui-text-primary) hover:bg-(--chrome-action-hover) transition-colors',
                children: `+ ${t}`
              }))
            })
          ]
        }) : null,

        jsxs(DialogFooter, {
          className: 'mt-4 pt-2 border-t border-(--ui-stroke-secondary) flex justify-end',
          children: [
            jsx(Button, {
              type: 'button',
              variant: 'ghost',
              onClick: () => onOpenChange(false),
              children: 'Done'
            })
          ]
        })
      ]
    })
  })
}

function copySessionId(sessionId) {
  return copyWithToast(sessionId, 'Session ID')
}

async function mutateForRoute(route, method, params = {}) {
  clearRouteCatalogCache()
  return requestForRoute(route, method, params, host, undefined, { fresh: true })
}

async function openSessionSafely(route, sessionId, intent = 'in-place') {
  try {
    await openSessionForRoute(route, sessionId, intent)
  } catch (err) {
    host.notifyError?.(err, intent === 'window' ? 'Failed to open session in a new window' : 'Failed to open session')
  }
}

// A stored session (what the Navigator lists) has no runtime id until it is
// loaded, and the gateway's per-session calls (session.title, session.history)
// only accept runtime ids; sent a stored id they answer "session not found".
// withStoredSession borrows the live handle when the session is already open in
// this window, and otherwise resumes it for the duration of `fn` and closes it
// again. It never closes a handle it did not open: resuming a session that is
// already live returns the SAME runtime id, so closing it would end the user's
// open session.
async function withStoredSession(route, storedId, fn) {
  const active = await requestForRoute(route, 'session.active_list', {}, host, undefined, { fresh: true })
  const open = (active?.sessions || []).find(row => row?.session_key === storedId)
  if (open?.id) return fn(open.id)

  const resumed = await requestForRoute(route, 'session.resume', { session_id: storedId, lazy: true })
  const runtimeId = resumed?.session_id
  if (!runtimeId) throw new Error('Could not open the session')
  try {
    return await fn(runtimeId)
  } finally {
    try {
      await requestForRoute(route, 'session.close', { session_id: runtimeId })
    } catch {
      // Best effort: the backend reaps detached runtimes on its own.
    }
  }
}

async function renameSession(session, route, title) {
  clearRouteCatalogCache()
  const result = await withStoredSession(route, session.id, runtimeId =>
    requestForRoute(route, 'session.title', { session_id: runtimeId, title })
  )
  invalidateRoute(route)
  return result
}

function fetchSessionMessages(session, route) {
  return withStoredSession(route, session.id, async runtimeId => {
    const history = await requestForRoute(route, 'session.history', { session_id: runtimeId })
    return history?.messages || []
  })
}

async function branchSession(session, route) {
  host.notify({ kind: 'info', message: 'Branching session…' })
  try {
    // branch_stored copies the transcript on the backend; it takes the stored id as parent_session_id.
    const result = await mutateForRoute(route, 'session.branch_stored', { parent_session_id: session.id })
    const newId = result?.stored_session_id
    if (!newId) throw new Error('Branch did not return a session id')
    invalidateRoute(route)
    await openSessionForRoute(route, newId)
    host.notify({ kind: 'success', message: 'Branched to new session' })
    return newId
  } catch (err) {
    host.notifyError?.(err, 'Failed to branch session')
    return null
  }
}

async function exportSession(session, route) {
  host.notify({ kind: 'info', message: 'Preparing session export…' })
  try {
    const messages = await fetchSessionMessages(session, route)
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

async function moveSessionToProject(sessionId, project, route) {
  const targetCwd = (project?.path || project?.repos?.find(r => r.path)?.path || '').trim()
  if (!targetCwd) {
    host.notify({ kind: 'error', message: 'Target project has no directory path' })
    return
  }
  try {
    await mutateForRoute(route, 'session.workspace.move', { session_key: sessionId, cwd: targetCwd })
    invalidateRoute(route)
    host.notify({ kind: 'success', message: `Moved to ${project.label || project.name || project.id}` })
  } catch (err) {
    host.notifyError?.(err, 'Failed to move session to project')
  }
}

async function archiveSession(sessionId, route) {
  try {
    await mutateForRoute(route, 'session.set_hidden', { session_id: sessionId, hidden: true })
    invalidateRoute(route)
    host.notify({ kind: 'success', message: 'Session archived' })
  } catch (err) {
    host.notifyError?.(err, 'Failed to archive session')
  }
}

async function deleteSession(sessionId, route) {
  try {
    await mutateForRoute(route, 'session.delete', { session_id: sessionId })
    invalidateRoute(route)
    host.notify({ kind: 'success', message: 'Session deleted' })
    const owner = focusedOwner()
    if (focusedOnRoute(owner, route, focusAtom.get(), sessionId)) host.navigate('/')
  } catch (err) {
    host.notifyError?.(err, 'Failed to delete session')
  }
}

async function openSessionInNewWindow(sessionId, route) {
  await openSessionSafely(route, sessionId, 'window')
}

// ── Bulk Selection & Actions ─────────────────────────────────────────────────
//
// Selection is scoped to ONE profile route at a time: ids are stored with the
// routeKey they were picked under, so a selection can never leak into another
// profile's list and every bulk request goes to the route that owns the ids.

const EMPTY_SELECTION = { active: false, routeKey: '', ids: [] }
const selectionAtom = atom(EMPTY_SELECTION)

function selectionFor(state, route) {
  const key = route ? routeKey(route) : ''
  return key && state?.routeKey === key ? state.ids : []
}

function toggleSelection(state, route, sessionId) {
  const key = routeKey(route)
  if (!key || !sessionId) return state || EMPTY_SELECTION
  const base = selectionFor(state, route)
  const ids = base.includes(sessionId) ? base.filter(id => id !== sessionId) : [...base, sessionId]
  return { active: true, routeKey: key, ids }
}

function addToSelection(state, route, sessionIds) {
  const key = routeKey(route)
  if (!key) return state || EMPTY_SELECTION
  const ids = [...selectionFor(state, route)]
  for (const id of sessionIds || []) if (id && !ids.includes(id)) ids.push(id)
  return { active: true, routeKey: key, ids }
}

function removeFromSelection(state, route, sessionIds) {
  const key = routeKey(route)
  if (!key) return state || EMPTY_SELECTION
  const drop = new Set(sessionIds || [])
  return {
    active: Boolean(state?.active),
    routeKey: key,
    ids: selectionFor(state, route).filter(id => !drop.has(id))
  }
}

function setSelectMode(on) {
  selectionAtom.set(on ? { active: true, routeKey: '', ids: [] } : EMPTY_SELECTION)
}

function toggleSessionSelected(route, sessionId) {
  selectionAtom.set(toggleSelection(selectionAtom.get(), route, sessionId))
}

function selectSessions(route, sessionIds) {
  selectionAtom.set(addToSelection(selectionAtom.get(), route, sessionIds))
}

function deselectSessions(route, sessionIds) {
  selectionAtom.set(removeFromSelection(selectionAtom.get(), route, sessionIds))
}

// Sequential on purpose: one bad session must not abort the rest, and the
// backend is not hammered with a burst of parallel destructive calls.
async function runBulk(ids, worker) {
  const done = []
  const failed = []
  for (const id of ids) {
    try {
      await worker(id)
      done.push(id)
    } catch (error) {
      failed.push({ id, error })
    }
  }
  return { done, failed }
}

// A session with a turn in flight must not be archived, deleted or moved out
// from under the agent. Only the local route can see busy state; remote routes
// are passed through unchanged.
function partitionBusy(ids, route) {
  if (!isLocalRoute(route)) return { runnable: [...ids], skipped: [] }
  const busy = readAtom(host?.state?.busyBySession) || {}
  const runnable = []
  const skipped = []
  for (const id of ids) (busy[id] ? skipped : runnable).push(id)
  return { runnable, skipped }
}

const BULK_ACTIONS = {
  archive: {
    verb: 'Archived',
    build: id => ['session.set_hidden', { session_id: id, hidden: true }]
  },
  delete: {
    verb: 'Deleted',
    build: id => ['session.delete', { session_id: id }]
  },
  move: {
    verb: 'Moved',
    build: (id, { cwd }) => ['session.workspace.move', { session_key: id, cwd }]
  }
}

function summarizeBulk(verb, { done = [], failed = [], skipped = [] } = {}) {
  const parts = []
  if (done.length) parts.push(`${verb} ${done.length} session${done.length === 1 ? '' : 's'}`)
  if (failed.length) {
    const reason = String(failed[0]?.error?.message || '').slice(0, 80)
    parts.push(`${failed.length} failed${reason ? ` (${reason})` : ''}`)
  }
  if (skipped.length) parts.push(`${skipped.length} skipped (running)`)
  if (!parts.length) parts.push('No sessions selected')
  return { kind: failed.length ? 'error' : done.length ? 'success' : 'info', message: parts.join(' · ') }
}

async function bulkMutate(action, ids, route, options = {}) {
  const spec = BULK_ACTIONS[action]
  if (!spec) throw new Error(`Unknown bulk action: ${action}`)
  const { runnable, skipped } = partitionBusy(ids, route)

  // Resolve the route fresh once; the rest of the batch reuses the cached catalog.
  clearRouteCatalogCache()
  let first = true
  const result = await runBulk(runnable, async id => {
    const [method, params] = spec.build(id, options)
    const fresh = first
    first = false
    return requestForRoute(route, method, params, host, undefined, { fresh })
  })

  invalidateRoute(route)
  deselectSessions(route, result.done)
  const outcome = { action, ...result, skipped }
  host.notify(summarizeBulk(spec.verb, outcome))

  if (action === 'delete' && result.done.length) {
    const owner = focusedOwner()
    const focusedId = focusAtom.get()
    if (result.done.some(id => focusedOnRoute(owner, route, focusedId, id))) host.navigate('/')
  }
  return outcome
}

// Tags are local storage, so the whole batch is one read-modify-write.
function bulkTag(ids, route, tag, mode = 'add') {
  const n = normalizeTag(tag)
  const result = { changed: 0, unchanged: 0, full: 0 }
  if (!n) return result
  const map = readSessionTagsMap(route)
  for (const id of ids) {
    const cur = map[id] || []
    if (mode === 'add') {
      if (cur.includes(n)) result.unchanged += 1
      else if (cur.length >= TAGS_PER_SESSION_MAX) result.full += 1
      else {
        map[id] = [...cur, n]
        result.changed += 1
      }
    } else if (!cur.includes(n)) {
      result.unchanged += 1
    } else {
      const next = cur.filter(t => t !== n)
      if (next.length) map[id] = next
      else delete map[id]
      result.changed += 1
    }
  }
  if (result.changed) writeSessionTagsMap(route, map)
  return result
}

function summarizeTag(tag, mode, { changed = 0, unchanged = 0, full = 0 } = {}) {
  const n = normalizeTag(tag)
  const parts = []
  if (changed) parts.push(`${mode === 'add' ? 'Tagged' : 'Untagged'} ${changed} session${changed === 1 ? '' : 's'} #${n}`)
  if (unchanged) parts.push(`${unchanged} unchanged`)
  if (full) parts.push(`${full} at the ${TAGS_PER_SESSION_MAX}-tag limit`)
  if (!parts.length) parts.push('Nothing to change')
  return { kind: full && !changed ? 'error' : changed ? 'success' : 'info', message: parts.join(' · ') }
}

const bulkBtn =
  'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-(--ui-stroke-secondary) px-2 ' +
  'text-[0.6875rem] font-medium text-(--ui-text-secondary) transition-colors ' +
  'hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary) disabled:cursor-not-allowed disabled:opacity-40'

function SelectBox({ checked = false, indeterminate = false, onToggle, label }) {
  const on = checked || indeterminate
  return jsx('span', {
    role: 'checkbox',
    'aria-checked': indeterminate && !checked ? 'mixed' : Boolean(checked),
    'aria-label': label,
    tabIndex: 0,
    className:
      'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors ' +
      (on
        ? 'border-(--ui-accent) bg-(--ui-accent) text-(--ui-bg-primary)'
        : 'border-(--ui-stroke-secondary) hover:border-(--ui-accent)'),
    onClick: (e) => {
      e.stopPropagation()
      onToggle()
    },
    onKeyDown: (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }
    },
    children: on ? jsx(Codicon, { name: checked ? 'check' : 'dash', size: '0.625rem' }) : null
  })
}

function BulkTagDialog({ open, onOpenChange, ids = [], route }) {
  useValue(tagsRevisionAtom)
  const [inputVal, setInputVal] = useState('')
  const available = getAllRouteTags(route)
  const tag = normalizeTag(inputVal)

  const apply = (mode) => {
    if (!tag) return
    host.notify(summarizeTag(tag, mode, bulkTag(ids, route, tag, mode)))
    setInputVal('')
    onOpenChange(false)
  }

  return jsx(Dialog, {
    open,
    onOpenChange: (val) => {
      onOpenChange(val)
      if (!val) setInputVal('')
    },
    children: jsxs(DialogContent, {
      className: 'max-w-sm p-4',
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: 'Tag selected sessions' }),
            jsx('p', {
              className: 'text-xs text-(--ui-text-quaternary) mt-0.5',
              children: `${ids.length} session${ids.length === 1 ? '' : 's'} selected`
            })
          ]
        }),
        jsx(Input, {
          autoFocus: true,
          placeholder: 'Tag name…',
          value: inputVal,
          onChange: (e) => setInputVal(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') apply('add')
          },
          className: 'mt-2 w-full text-xs'
        }),
        available.length > 0 ? jsx('div', {
          className: 'mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto',
          children: available.map(t => jsx('button', {
            type: 'button',
            key: t,
            onClick: () => setInputVal(t),
            className: 'rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-xs text-(--ui-text-secondary) hover:text-(--ui-text-primary) hover:bg-(--chrome-action-hover) transition-colors',
            children: `#${t}`
          }))
        }) : null,
        jsxs(DialogFooter, {
          className: 'mt-3 pt-2 border-t border-(--ui-stroke-secondary) flex justify-end gap-1.5',
          children: [
            jsx(Button, { type: 'button', variant: 'ghost', onClick: () => onOpenChange(false), children: 'Cancel' }),
            jsx(Button, { type: 'button', variant: 'ghost', disabled: !tag, onClick: () => apply('remove'), children: 'Remove tag' }),
            jsx(Button, { type: 'button', disabled: !tag, onClick: () => apply('add'), children: 'Add tag' })
          ]
        })
      ]
    })
  })
}

function BulkBar({ route }) {
  const selection = useValue(selectionAtom)
  const ids = selectionFor(selection, route)
  const count = ids.length
  const [working, setWorking] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

  const treeQuery = useQuery({
    queryKey: queryKey('projects-list', route),
    queryFn: () => fetchProjectList(route),
    enabled: Boolean(route) && moveOpen,
    staleTime: 60000
  })
  const movableProjects = (treeQuery.data?.projects || []).filter(p => !p.isNoProject && resolveProjectCwd(p))

  const run = async (fn) => {
    setWorking(true)
    try {
      await fn()
    } catch (err) {
      host.notifyError?.(err, 'Bulk action failed')
    } finally {
      setWorking(false)
    }
  }

  const idle = count === 0 || working
  return jsxs('div', {
    className: 'flex flex-wrap items-center gap-1.5 border-b border-(--ui-stroke-secondary) bg-(--ui-bg-subtle) px-2.5 py-1.5',
    role: 'toolbar',
    'aria-label': 'Bulk session actions',
    children: [
      jsx('span', {
        className: 'mr-auto text-[0.75rem] font-medium text-(--ui-text-primary) tabular-nums',
        children: count ? `${count} selected` : 'Select sessions'
      }),
      jsxs('button', {
        type: 'button', className: bulkBtn, disabled: idle, title: 'Add or remove a tag on the selected sessions',
        onClick: () => setTagOpen(true),
        children: [jsx(Codicon, { name: 'tag', size: '0.75rem' }), jsx('span', { children: 'Tag…' })]
      }),
      jsxs('button', {
        type: 'button', className: bulkBtn, disabled: idle, title: 'Move the selected sessions to a project',
        onClick: () => setMoveOpen(true),
        children: [jsx(Codicon, { name: 'folder', size: '0.75rem' }), jsx('span', { children: 'Move…' })]
      }),
      jsxs('button', {
        type: 'button', className: bulkBtn, disabled: idle, title: 'Archive the selected sessions',
        onClick: () => void run(() => bulkMutate('archive', ids, route)),
        children: [jsx(Codicon, { name: 'archive', size: '0.75rem' }), jsx('span', { children: 'Archive' })]
      }),
      jsxs('button', {
        type: 'button', className: bulkBtn, disabled: idle, title: 'Delete the selected sessions',
        onClick: () => setDeleteOpen(true),
        children: [jsx(Codicon, { name: 'trash', size: '0.75rem' }), jsx('span', { children: 'Delete' })]
      }),
      jsx('button', {
        type: 'button', className: bulkBtn, disabled: count === 0 || working, title: 'Clear the selection',
        onClick: () => deselectSessions(route, ids),
        children: 'Clear'
      }),
      jsx(ConfirmDialog, {
        open: deleteOpen,
        onClose: () => setDeleteOpen(false),
        title: `Delete ${count} session${count === 1 ? '' : 's'}`,
        description: `Delete the ${count} selected session${count === 1 ? '' : 's'}? Sessions that are currently running are skipped. This action cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
        onConfirm: () => run(() => bulkMutate('delete', ids, route))
      }),
      jsx(BulkTagDialog, { open: tagOpen, onOpenChange: setTagOpen, ids, route }),
      jsx(WhereDialog, {
        open: moveOpen,
        onOpenChange: setMoveOpen,
        projects: movableProjects,
        route,
        title: 'Move sessions',
        description: `Move ${count} selected session${count === 1 ? '' : 's'} to which project?`,
        includeHome: false,
        onPick: (project) => run(() => bulkMutate('move', ids, route, { cwd: resolveProjectCwd(project) }))
      })
    ]
  })
}

// ── Project-Scoped Session Creation & "Where?" Dialog ────────────────────────

function resolveProjectCwd(project) {
  if (!project || project.isNoProject) return null
  return (project.path || project.repos?.find(r => r.path)?.path || '').trim() || null
}

async function createSessionInProject(targetProject, route) {
  const label = targetProject?.isNoProject || !targetProject
    ? 'Home'
    : (targetProject.label || targetProject.name || targetProject.id)
  try {
    const targetCwd = resolveProjectCwd(targetProject)
    const params = {}
    if (targetCwd !== null) {
      params.cwd = targetCwd
    }
    const result = await mutateForRoute(route, 'session.create', params)
    const newId = result?.stored_session_id || result?.session_key || result?.session_id
    if (!newId) throw new Error('Create session did not return a session id')
    invalidateRoute(route)
    await openSessionForRoute(route, newId, 'in-place')
    host.notify({ kind: 'success', message: `Started new session in ${label}` })
    return newId
  } catch (err) {
    host.notifyError?.(err, `Failed to create session in ${label}`)
    throw err
  }
}

function WhereDialog({
  open,
  onOpenChange,
  projects = [],
  route,
  title = 'Start New Session',
  description = 'Where would you like to create this session?',
  includeHome = true,
  onPick = null
}) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()

  const homeItem = {
    id: '__home__',
    isNoProject: true,
    label: 'Home',
    path: null
  }

  const projectItems = projects.filter(p => !p.isNoProject)
  const filteredProjects = q
    ? projectItems.filter(p => {
        const name = (p.label || p.name || p.id || '').toLowerCase()
        const path = (p.path || '').toLowerCase()
        return name.includes(q) || path.includes(q)
      })
    : projectItems

  const handleSelect = async (target) => {
    onOpenChange(false)
    setFilter('')
    if (onPick) {
      await Promise.resolve(onPick(target)).catch(() => {})
      return
    }
    await createSessionInProject(target, route).catch(() => {})
  }

  return jsx(Dialog, {
    open,
    onOpenChange: (val) => {
      onOpenChange(val)
      if (!val) setFilter('')
    },
    children: jsxs(DialogContent, {
      className: 'max-w-md p-4',
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: title }),
            jsx('p', {
              className: 'text-xs text-(--ui-text-quaternary) mt-0.5',
              children: description
            })
          ]
        }),
        jsx(Input, {
          autoFocus: true,
          placeholder: 'Filter projects…',
          value: filter,
          onChange: (e) => setFilter(e.target.value),
          className: 'mt-2 mb-2 w-full text-xs'
        }),
        jsxs('div', {
          className: 'max-h-64 min-h-24 overflow-y-auto space-y-1 pr-1',
          children: [
            // Home (Always available at top unless filtered specifically out)
            (includeHome && (!q || 'home'.includes(q))) ? jsx('button', {
              type: 'button',
              className: 'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs hover:bg-(--chrome-action-hover) transition-colors border border-transparent hover:border-(--ui-stroke-secondary)',
              onClick: () => void handleSelect(homeItem),
              children: [
                jsx(IconOr, { icon: 'Home', glyph: '🏠' }),
                jsxs('div', {
                  className: 'min-w-0 flex-1',
                  children: [
                    jsx('div', { className: 'font-semibold text-(--ui-text-primary)', children: 'Home' }),
                    jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary) truncate', children: 'No workspace · general chat' })
                  ]
                })
              ]
            }) : null,

            // Filtered Projects
            filteredProjects.map(proj => {
              const name = proj.label || proj.name || proj.id
              const pCwd = resolveProjectCwd(proj)
              return jsx('button', {
                key: proj.id,
                type: 'button',
                className: 'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs hover:bg-(--chrome-action-hover) transition-colors border border-transparent hover:border-(--ui-stroke-secondary)',
                onClick: () => void handleSelect(proj),
                children: [
                  proj.color
                    ? jsx('span', {
                        className: 'h-2.5 w-2.5 shrink-0 rounded-full',
                        style: { backgroundColor: proj.color }
                      })
                    : jsx(IconOr, { icon: 'Folder', glyph: '📁' }),
                  jsxs('div', {
                    className: 'min-w-0 flex-1',
                    children: [
                      jsx('div', { className: 'font-semibold text-(--ui-text-primary) truncate', children: name }),
                      pCwd ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary) truncate', children: pCwd }) : null
                    ]
                  })
                ]
              })
            }),

            (filteredProjects.length === 0 && (!includeHome || !q || !'home'.includes(q))) ? jsx('div', {
              className: `${hintStyle} py-3 text-center`,
              children: 'No matching projects found'
            }) : null
          ]
        }),
        jsxs(DialogFooter, {
          className: 'mt-3 pt-2 border-t border-(--ui-stroke-secondary) flex justify-end',
          children: [
            jsx(Button, {
              type: 'button',
              variant: 'ghost',
              onClick: () => {
                onOpenChange(false)
                setFilter('')
              },
              children: 'Cancel'
            })
          ]
        })
      ]
    })
  })
}

// ── Profile Identity Glyph & Colors ──────────────────────────────────────────

function profileColor(name) {
  if (typeof sdkProfileColor === 'function') {
    const res = sdkProfileColor(name)
    if (res !== undefined) return res
  }
  const key = text(name)
  if (!key || key.toLowerCase() === 'default') return null
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  return `hsl(${hue} 68% 58%)`
}

function profileColorSoft(color, percent = 16) {
  if (typeof sdkProfileColorSoft === 'function') {
    const res = sdkProfileColorSoft(color, percent)
    if (res !== undefined) return res
  }
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

function resolveSessionProfile(session, route) {
  const sProfile = text(session?.profile)
  if (sProfile) return sProfile
  const rProfile = text(route?.profile)
  if (rProfile) return rProfile
  return 'default'
}

function shouldShowProfileBadge(profileName) {
  const key = text(profileName).toLowerCase()
  return Boolean(key && key !== 'default')
}

function ProfileGlyph({ name, colorOverride, className }) {
  const profileKey = text(name)
  if (!shouldShowProfileBadge(profileKey)) return null

  const initial = profileKey.replace(/[^a-z0-9]/gi, '').charAt(0).toUpperCase() || '?'
  const color = colorOverride || profileColor(profileKey) || 'var(--ui-text-quaternary)'
  const bg = profileColorSoft(color, 22)
  const label = `Owned by profile ${profileKey}`

  return jsx('span', {
    role: 'img',
    'aria-label': label,
    title: label,
    className: `grid size-4 shrink-0 place-items-center rounded-[3px] text-[0.5rem] font-semibold uppercase leading-none ${className || ''}`.trim(),
    style: {
      backgroundColor: bg,
      color: color
    },
    children: initial
  })
}

// ── Session Row with Context Menu ───────────────────────────────────────────

function SessionStatusIndicator({ session, route, colorOverride }) {
  const isLocal = isLocalRoute(route)
  if (isLocal && typeof SessionStatusDot === 'function') {
    return jsx(SessionStatusDot, {
      storedSessionId: session.id,
      session,
      className: 'shrink-0'
    })
  }

  // Cross-profile or fallback rendering:
  return jsx('span', {
    className: 'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-(--ui-text-quaternary)',
    style: colorOverride ? { backgroundColor: colorOverride, opacity: 0.9 } : undefined
  })
}

function SessionRow({ session, focused, project, allProjects, route }) {
  const owner = focusedOwner()
  const isCurrent = focused && focusedOnRoute(owner, route, focusAtom.get(), session.id)
  const tokenStr = formatTokens((session.input_tokens || 0) + (session.output_tokens || 0))
  const ageStr = timeAgo(session.started_at)
  const meta = [tokenStr !== '0' ? tokenStr : null, ageStr].filter(Boolean).join(' · ')

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(session.title || '')
  const [renaming, setRenaming] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const [pinned, setPinned] = useState(() => isSessionPinned(session.id, session, route))
  const [unread, setUnread] = useState(() => Boolean(session.unread) || readIdList(route, 'unread').includes(session.id))
  const [colorOverride, setColorOverride] = useState(() => getSessionColorOverride(session.id, route))

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
      await renameSession(session, route, next)
      host.notify({ kind: 'success', message: 'Renamed session' })
      setRenameOpen(false)
    } catch (err) {
      host.notifyError?.(err, 'Failed to rename session')
    } finally {
      setRenaming(false)
    }
  }

  const isLocal = isLocalRoute(route)
  const busyMap = useValue(host?.state?.busyBySession) || {}
  const isBusy = Boolean(isLocal && session.id && (busyMap[session.id] || (isCurrent && host?.state?.busy && useValue(host?.state?.busy))))

  const selection = useValue(selectionAtom)
  const selectMode = Boolean(selection?.active)
  const selected = selectMode && selectionFor(selection, route).includes(session.id)

  const sessionProfile = resolveSessionProfile(session, route)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  useValue(tagsRevisionAtom)
  const sessionTags = session.id ? getSessionTags(session.id, route) : []

  const rowButton = jsxs('button', {
    type: 'button',
    className: (isCurrent ? rowBtnActive : rowBtn) + (selected ? ' bg-(--ui-accent)/10' : ''),
    'aria-pressed': selectMode ? selected : undefined,
    onClick: () => {
      if (selectMode) toggleSessionSelected(route, session.id)
      else void openSessionSafely(route, session.id)
    },
    title: session.title || session.preview || session.id,
    children: [
      isBusy ? jsx('span', { 'aria-hidden': 'true', className: 'arc-border arc-row' }) : null,
      selectMode ? jsx(SelectBox, {
        checked: selected,
        label: `Select ${session.title || session.preview || session.id}`,
        onToggle: () => toggleSessionSelected(route, session.id)
      }) : null,
      jsx(SessionStatusIndicator, { session, route, colorOverride }),
      shouldShowProfileBadge(sessionProfile) ? jsx(ProfileGlyph, { name: sessionProfile }) : null,
      jsx('span', {
        className: 'min-w-0 flex-1 truncate text-left',
        children: session.title || session.preview || session.id
      }),
      sessionTags.length > 0 ? jsx(SessionTagBadges, {
        tags: sessionTags,
        maxVisible: 2,
        onTagClick: (tag) => {
          queryAtom.set(toggleTagInQuery(queryAtom.get(), tag))
        }
      }) : null,
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
                  void openSessionInNewWindow(session.id, route)
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
                onSelect: async () => {
                  haptic?.('selection')
                  try {
                    const next = await toggleSessionPin(session.id, pinned, route)
                    setPinned(next)
                    host.notify({
                      kind: 'info',
                      message: next ? 'Pinned in Navigator' : 'Unpinned in Navigator'
                    })
                  } catch (err) {
                    host.notifyError?.(err, 'Failed to update Navigator pin')
                  }
                },
                children: [
                  jsx(Codicon, { name: 'pin', size: '0.875rem' }),
                  jsx('span', { children: pinned ? 'Unpin' : 'Pin' })
                ]
              }),
              // 4. Mark as unread / Mark as read
              jsxs(ContextMenuItem, {
                onSelect: async () => {
                  haptic?.('selection')
                  try {
                    const next = await toggleSessionUnread(session.id, unread, route)
                    setUnread(next)
                    host.notify({
                      kind: 'info',
                      message: next ? 'Marked unread in Navigator' : 'Marked read in Navigator'
                    })
                  } catch (err) {
                    host.notifyError?.(err, 'Failed to update Navigator unread state')
                  }
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
                        setSessionColorOverride(session.id, color, route)
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
              // 6b. Tags
              jsxs(ContextMenuItem, {
                onSelect: () => {
                  haptic?.('selection')
                  setTagDialogOpen(true)
                },
                children: [
                  jsx(Codicon, { name: 'tag', size: '0.875rem' }),
                  jsx('span', { children: 'Tags…' })
                ]
              }),
              // Separator 1
              jsx(ContextMenuSeparator, {}),
              // Fast-path: New session in this project (if within project)
              (project && !project.isNoProject) ? jsxs(ContextMenuItem, {
                onSelect: () => void createSessionInProject(project, route),
                children: [
                  jsx(Codicon, { name: 'add', size: '0.875rem' }),
                  jsx('span', { children: `New session in ${project.label || project.name || project.id}` })
                ]
              }) : null,
              // Chooser-path: New session (choose location)… (always available)
              jsxs(ContextMenuItem, {
                onSelect: () => openWhereDialog(route),
                children: [
                  jsx(Codicon, { name: 'add', size: '0.875rem' }),
                  jsx('span', { children: 'New session (choose location)…' })
                ]
              }),
              // 7. Branch
              jsxs(ContextMenuItem, {
                onSelect: () => void branchSession(session, route),
                children: [
                  jsx(Codicon, { name: 'repo-forked', size: '0.875rem' }),
                  jsx('span', { children: 'Branch' })
                ]
              }),
              // 8. Export
              jsxs(ContextMenuItem, {
                onSelect: () => void exportSession(session, route),
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
                            onSelect: () => void moveSessionToProject(session.id, proj, route),
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
                onSelect: () => void archiveSession(session.id, route),
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
      // Rename Dialog (mounted only while open: 500 idle dialogs per Timeline was costly)
      renameOpen ? jsx(Dialog, {
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
      }) : null,
      // Delete Confirmation Dialog
      deleteOpen ? jsx(ConfirmDialog, {
        open: deleteOpen,
        onClose: () => setDeleteOpen(false),
        title: 'Delete session',
        description: `Are you sure you want to delete "${session.title || session.preview || session.id}"? This action cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
        onConfirm: () => deleteSession(session.id, route)
      }) : null,
      // Tag Management Dialog
      tagDialogOpen ? jsx(TagDialog, {
        open: tagDialogOpen,
        onOpenChange: setTagDialogOpen,
        session,
        route
      }) : null
    ]
  })
}

// ── Sessions Flattened View ──────────────────────────────────────────────────

function ShowMoreButton({ total, shown, onMore }) {
  if (total <= shown) return null
  const next = Math.min(ROW_PAGE_SIZE, total - shown)
  return jsx('button', {
    type: 'button',
    className: 'mt-1 w-full rounded py-1 text-center text-[0.6875rem] font-medium text-(--ui-accent) hover:bg-(--chrome-action-hover) transition-colors',
    onClick: onMore,
    children: `Show ${next} more (${total - shown} hidden)`
  })
}

function SessionBrowser({ route }) {
  const [shown, setShown] = useState(ROW_PAGE_SIZE)
  useValue(tagsRevisionAtom)
  const q = useValue(queryAtom).trim()
  const currentId = useValue(focusAtom)
  const tagsMap = tagsMapFor(route)
  const selection = useValue(selectionAtom)

  const listQuery = useQuery(sessionListQuery(route))

  // Only the project list is needed here (Move menu), so skip the session previews
  // and keep it out of the Projects view's cache entry.
  const treeQuery = useQuery({
    queryKey: queryKey('projects-list', route),
    queryFn: () => fetchProjectList(route),
    enabled: Boolean(route),
    staleTime: 60000
  })

  const allProjects = treeQuery.data?.projects || []
  const rawSessions = listQuery.data?.sessions ?? []
  const filtered = rawSessions
    .filter((s) => (s.message_count ?? 0) > 0)
    .filter((s) => {
      const sTags = tagsMap[s.id] || []
      return matchesSessionFilter(s, q, sTags)
    })
    .sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))
  const selectedIds = new Set(selectionFor(selection, route))
  const visibleSelectedCount = filtered.filter(s => selectedIds.has(s.id)).length

  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col overflow-hidden',
    children: [
      jsx(TagFilterBar, { route, className: 'px-2 pb-1 border-b border-(--ui-stroke-secondary)' }),
      jsxs('div', {
        className: `${hintStyle} flex items-center gap-2 px-3 py-1`,
        children: [
          selection?.active && filtered.length ? jsx(SelectBox, {
            checked: visibleSelectedCount === filtered.length,
            indeterminate: visibleSelectedCount > 0 && visibleSelectedCount < filtered.length,
            label: 'Select all visible sessions',
            onToggle: () => (visibleSelectedCount === filtered.length ? deselectSessions : selectSessions)(route, filtered.map(s => s.id))
          }) : null,
          jsx('span', {
            children: listQuery.status === 'pending'
              ? 'Loading sessions…'
              : listQuery.status === 'error'
                ? describeBrowseError(listQuery.error, route, 'sessions')
                : `${filtered.length} session${filtered.length === 1 ? '' : 's'}`
          })
        ]
      }),
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto px-1.5 pb-3',
        children: [
          ...filtered.slice(0, shown).map((s) =>
            jsx(SessionRow, { session: s, focused: s.id === currentId, allProjects, route }, rowKey(route, s.id))
          ),
          jsx(ShowMoreButton, { total: filtered.length, shown, onMore: () => setShown(shown + ROW_PAGE_SIZE) }, '__more__')
        ]
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

function ProjectCard({ project, allProjects, currentId, filterQuery, route }) {
  const [expanded, setExpanded] = useState(true)
  const [loadAll, setLoadAll] = useState(false)
  const [shown, setShown] = useState(ROW_PAGE_SIZE)

  const preview = project.previewSessions ?? []
  const totalCount = Number(project.sessionCount ?? preview.length)

  // Full session fetch when requested or if totalCount > preview.length
  const fullQuery = useQuery({
    queryKey: queryKey('project-sessions', route, [project.id]),
    queryFn: () => requestForRoute(route, 'projects.project_sessions', {
      project_id: project.id,
      session_limit: PROJECT_SESSION_LIMIT
    }),
    enabled: Boolean(route) && loadAll,
    staleTime: 10000
  })

  let sessions = loadAll
    ? extractSessionsFromProjectTree(fullQuery.data?.project)
    : preview

  const tagsMap = tagsMapFor(route)

  if (filterQuery) {
    sessions = sessions.filter((s) => {
      const sTags = tagsMap[s.id] || []
      return matchesSessionFilter(s, filterQuery, sTags)
    })
  }

  const hasTruncated = !loadAll && totalCount > preview.length

  const isLocal = isLocalRoute(route)
  const busyMap = useValue(host?.state?.busyBySession) || {}
  const activeCount = isLocal
    ? (sessions || []).filter(s => s?.id && busyMap[s.id]).length
    : 0

  const projectLabel = project.isNoProject ? 'Home' : (project.label || project.name || project.id)
  const projectCwd = resolveProjectCwd(project)

  const selection = useValue(selectionAtom)
  const selectedIds = new Set(selectionFor(selection, route))
  const visibleSelectedCount = (sessions || []).filter(s => s?.id && selectedIds.has(s.id)).length

  const headerRow = jsxs('div', {
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
      selection?.active && sessions.length ? jsx(SelectBox, {
        checked: visibleSelectedCount === sessions.length,
        indeterminate: visibleSelectedCount > 0 && visibleSelectedCount < sessions.length,
        label: `Select all sessions in ${projectLabel}`,
        onToggle: () => (visibleSelectedCount === sessions.length ? deselectSessions : selectSessions)(route, sessions.map(s => s.id))
      }) : null,
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
        children: projectLabel
      }),
      activeCount > 0 ? jsx('span', {
        className: 'shrink-0 flex items-center gap-1 rounded-full bg-(--ui-accent)/15 px-1.5 py-0.2 text-[0.625rem] font-medium text-(--ui-accent)',
        title: `${activeCount} active session${activeCount === 1 ? '' : 's'}`,
        children: [
          jsx('span', { className: 'inline-block h-1.5 w-1.5 rounded-full bg-(--ui-accent)' }),
          jsx('span', { children: `${activeCount} active` })
        ]
      }) : null,
      jsx('button', {
        type: 'button',
        className: 'shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium text-(--ui-text-secondary) hover:text-(--ui-text-primary) hover:bg-(--chrome-action-hover) border border-(--ui-stroke-secondary) transition-colors',
        title: `New session in ${projectLabel}`,
        onClick: (e) => {
          e.stopPropagation()
          void createSessionInProject(project, route)
        },
        children: [
          jsx(Codicon, { name: 'add', size: '0.75rem' }),
          jsx('span', { className: 'hidden sm:inline', children: 'New' })
        ]
      }),
      !project.isNoProject ? jsx('button', {
        type: 'button',
        className: 'shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium text-(--ui-text-secondary) hover:text-(--ui-text-primary) hover:bg-(--chrome-action-hover) border border-(--ui-stroke-secondary) transition-colors',
        title: `Open Cockpit for ${projectLabel}`,
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
  })

  return jsxs('div', {
    className: 'mb-3 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-subtle)/30 p-1.5',
    children: [
      // Project Header with Context Menu
      jsxs(ContextMenu, {
        children: [
          jsx(ContextMenuTrigger, {
            asChild: true,
            children: headerRow
          }),
          jsxs(ContextMenuContent, {
            className: 'w-48',
            children: [
              // Fast-path: New session in this project
              jsxs(ContextMenuItem, {
                onSelect: () => void createSessionInProject(project, route),
                children: [
                  jsx(Codicon, { name: 'add', size: '0.875rem' }),
                  jsx('span', { children: `New session in ${projectLabel}` })
                ]
              }),
              // Chooser-path: New session (choose location)…
              jsxs(ContextMenuItem, {
                onSelect: () => openWhereDialog(route),
                children: [
                  jsx(Codicon, { name: 'add', size: '0.875rem' }),
                  jsx('span', { children: 'New session (choose location)…' })
                ]
              }),
              !project.isNoProject ? jsxs(ContextMenuItem, {
                onSelect: () => {
                  const slug = project.id || project.name || project.label || ''
                  host.navigate(`/cockpit?project=${encodeURIComponent(slug)}`)
                },
                children: [
                  jsx(Codicon, { name: 'zap', size: '0.875rem' }),
                  jsx('span', { children: 'Open Cockpit' })
                ]
              }) : null,
              projectCwd ? jsxs(ContextMenuItem, {
                onSelect: () => void copyWithToast(projectCwd, 'Project path'),
                children: [
                  jsx(Codicon, { name: 'copy', size: '0.875rem' }),
                  jsx('span', { children: 'Copy path' })
                ]
              }) : null
            ]
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
                : [
                    ...sessions.slice(0, shown).map((s) =>
                      jsx(SessionRow, { session: s, focused: s.id === currentId, project, allProjects, route }, `${project.id}/${rowKey(route, s.id)}`)
                    ),
                    jsx(ShowMoreButton, { total: sessions.length, shown, onMore: () => setShown(shown + ROW_PAGE_SIZE) }, '__more__')
                  ]
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

function ProjectBrowser({ route }) {
  useValue(tagsRevisionAtom)
  const q = useValue(queryAtom).trim()
  const currentId = useValue(focusAtom)

  const treeQuery = useQuery({
    queryKey: queryKey('projects-tree', route),
    queryFn: () => requestForRoute(route, 'projects.tree', { preview_limit: TREE_PREVIEW_LIMIT }),
    enabled: Boolean(route),
    refetchInterval: 20000,
    staleTime: 8000
  })

  if (treeQuery.status === 'pending') {
    return jsx('div', { className: `${hintStyle} p-3`, children: 'Loading project catalog…' })
  }

  if (treeQuery.status === 'error') {
    return jsx('div', {
      className: `${hintStyle} p-3`,
      role: 'alert',
      children: describeBrowseError(treeQuery.error, route, 'projects')
    })
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

  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col overflow-hidden',
    children: [
      jsx(TagFilterBar, { route, className: 'px-2 pb-1 border-b border-(--ui-stroke-secondary)' }),
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto px-2 py-1.5',
        children: projects.map((p) =>
          jsx(ProjectCard, { project: p, allProjects: projects, currentId, filterQuery: q, route }, `${routeKey(route)}/${p.id}`)
        )
      })
    ]
  })
}

// ── Navigator Shell (Main Pane) ──────────────────────────────────────────────

function useRouteCatalog(connectionId, profile) {
  const [routes, setRoutes] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const generation = useRef(0)

  const refresh = async () => {
    const requestGeneration = ++generation.current
    setStatus('loading')
    try {
      const next = await discoverRoutes()
      if (requestGeneration !== generation.current) return []
      if (next === null) {
        const fallback = legacyActiveRoute(profile)
        const legacy = fallback ? [fallback] : []
        setRoutes(legacy)
        setStatus(legacy.length ? 'legacy' : 'error')
        setError(legacy.length ? 'Profile browsing needs a newer Hermes Desktop; showing the active profile only.' : 'No active profile is available.')
        browseStateAtom.set(reconcileBrowseState({ manual: false, selected: null }, legacy, connectionId, profile))
        return legacy
      }
      setRoutes(next)
      setStatus(next.length ? 'ready' : 'error')
      setError(next.length ? '' : 'No profile routes are currently available.')
      browseStateAtom.set(reconcileBrowseState(browseStateAtom.get(), next, connectionId, profile))
      return next
    } catch (reason) {
      if (requestGeneration !== generation.current) return []
      setRoutes([])
      setStatus('error')
      setError(reason?.message || 'Profile routes are unavailable.')
      browseStateAtom.set(reconcileBrowseState(browseStateAtom.get(), [], connectionId, profile))
      return []
    }
  }

  useEffect(() => {
    generation.current += 1
    void refresh()
  }, [connectionId, profile])

  return { routes, status, error, refresh }
}

function ProfileSelector({ catalog, activeRoute }) {
  const browse = useValue(browseStateAtom)
  const duplicates = duplicateProfileNames(catalog.routes)
  const selected = browse.selected || (!browse.manual ? activeRoute : null)

  return jsxs('div', {
    className: 'border-b border-(--ui-stroke-secondary) px-2.5 py-2',
    children: [
      jsxs('div', {
        className: 'mb-1 flex items-center justify-between gap-2',
        children: [
          jsx('span', { className: hintStyle, children: 'Browse profile' }),
          jsx('button', {
            type: 'button',
            className: chipBtn,
            disabled: catalog.status === 'loading',
            title: 'Refresh profile routes and this profile’s data',
            onClick: async () => {
              await catalog.refresh()
              if (browseStateAtom.get().selected) invalidateRoute(browseStateAtom.get().selected)
            },
            children: jsx(IconOr, { icon: 'RefreshCw', glyph: '↻' })
          })
        ]
      }),
      catalog.routes.length
        ? jsx('div', {
            className: 'min-w-0 overflow-x-auto overflow-y-hidden',
            children: jsx('div', {
              className: 'flex w-max items-center gap-1',
              role: 'group',
              'aria-label': 'Navigator profile scope',
              children: catalog.routes.map(route => {
                const key = routeKey(route)
                const chosen = selected && key === routeKey(selected)
                const active = activeRoute && key === routeKey(activeRoute)
                const label = routeLabel(route, duplicates)
                return jsx('button', {
                  type: 'button',
                  key,
                  className: chosen ? segActive : segIdle,
                  'aria-pressed': Boolean(chosen),
                  'aria-label': `${label}${active ? ', active Desktop profile' : ''}`,
                  title: active ? `${label} — active Desktop profile` : `Browse ${label}`,
                  onClick: () => browseStateAtom.set({ manual: true, selected: route, unavailable: null }),
                  children: `${label}${active ? ' · active' : ''}`
                })
              })
            })
          })
        : jsx('div', { className: hintStyle, children: catalog.error || 'Loading profile routes…' }),
      browse.unavailable
        ? jsx('div', {
            className: `${hintStyle} mt-1`,
            children: `The selected profile (${routeLabel(browse.unavailable, duplicates)}) is no longer available. Choose another profile.`
          })
        : catalog.status === 'legacy'
          ? jsx('div', { className: `${hintStyle} mt-1`, children: catalog.error })
          : null
    ]
  })
}

// The full page is a route with no chrome of its own, so give it a way out:
// back to wherever the user came from, else home.
function closeNavigatorPage() {
  try {
    if (typeof window !== 'undefined' && window.history?.length > 1) {
      window.history.back()
      return
    }
  } catch {
    // fall through to home
  }
  host.navigate('/')
}

function NavigatorShell({ onClose } = {}) {
  const view = useValue(viewAtom)
  const q = useValue(queryAtom)
  const profile = useValue(host.state.profile)
  const connectionId = host.state.connectionId ? useValue(host.state.connectionId) : ''
  const browse = useValue(browseStateAtom)
  const catalog = useRouteCatalog(connectionId, profile)
  const activeRoute = activeRouteFrom(catalog.routes, connectionId, profile)
  const selectedRoute = browse.selected || (!browse.manual ? activeRoute : null)
  const whereState = useValue(whereStateAtom)
  const whereOpen = Boolean(whereState?.open)
  const selection = useValue(selectionAtom)
  const selectMode = Boolean(selection?.active)

  // Warm the Timeline as soon as a profile is chosen, so the switch is instant.
  const selectedRouteKey = routeKey(selectedRoute)
  useEffect(() => {
    prefetchTimeline(selectedRoute)
  }, [selectedRouteKey])

  // Query projects for WhereDialog when route is selected
  const projectsQuery = useQuery({
    queryKey: queryKey(selectedRoute, 'projects.tree'),
    queryFn: () => requestForRoute(selectedRoute, 'projects.tree'),
    enabled: Boolean(selectedRoute && whereOpen),
    staleTime: ROUTE_CACHE_TTL_MS
  })
  const availableProjects = (projectsQuery.data?.projects || [])

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col bg-(--ui-bg-primary) text-(--ui-text-primary)',
    children: [
      onClose ? jsxs('div', {
        className: 'flex items-center justify-between gap-2 border-b border-(--ui-stroke-secondary) px-2.5 py-1.5',
        children: [
          jsx('span', { className: 'text-[0.8125rem] font-semibold text-(--ui-text-primary)', children: 'Navigator' }),
          jsx('button', {
            type: 'button',
            className: chipBtn,
            'aria-label': 'Close Navigator',
            title: 'Close Navigator',
            onClick: onClose,
            children: jsx(Codicon, { name: 'close', size: '0.875rem' })
          })
        ]
      }) : null,
      jsx(ProfileSelector, { catalog, activeRoute }),
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
              jsxs('div', {
                className: 'flex items-center gap-1',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: chipBtn + (selectMode ? ' border-(--ui-accent) text-(--ui-accent)' : ''),
                    disabled: !selectedRoute,
                    'aria-pressed': selectMode,
                    title: selectMode ? 'Exit select mode' : 'Select sessions for bulk actions',
                    onClick: () => setSelectMode(!selectMode),
                    children: jsx(Codicon, { name: 'checklist', size: '0.875rem' })
                  }),
                  jsx('button', {
                    type: 'button',
                    className: chipBtn,
                    disabled: !selectedRoute,
                    title: 'New session (choose location)',
                    onClick: () => openWhereDialog(selectedRoute),
                    children: jsx(Codicon, { name: 'add', size: '0.875rem' })
                  }),
                  jsx('button', {
                    type: 'button',
                    className: chipBtn,
                    disabled: !selectedRoute,
                    title: selectedRoute ? `Refresh ${routeLabel(selectedRoute)}` : 'Choose a profile first',
                    onClick: () => selectedRoute && invalidateRoute(selectedRoute),
                    children: jsx(IconOr, { icon: 'RefreshCw', glyph: '↻' })
                  })
                ]
              })
            ]
          }),
          jsx('input', {
            type: 'search',
            placeholder: 'Filter sessions or projects…',
            value: q,
            onChange: (e) => queryAtom.set(e.target.value),
            className: 'w-full rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-subtle) px-2.5 py-1 text-xs text-(--ui-text-primary) outline-none placeholder:text-(--ui-text-quaternary) focus:border-(--ui-accent)'
          }),
          jsx(SavedViewsBar, { route: selectedRoute }, routeKey(selectedRoute) || 'no-route')
        ]
      }),
      selectMode && selectedRoute ? jsx(BulkBar, { route: selectedRoute }, routeKey(selectedRoute)) : null,
      jsx(WhereDialog, {
        open: whereOpen,
        onOpenChange: (val) => {
          if (!val) closeWhereDialog()
          else openWhereDialog(selectedRoute)
        },
        projects: availableProjects,
        route: whereState?.route || selectedRoute
      }),
      jsxs(ContextMenu, {
        children: [
          jsx(ContextMenuTrigger, {
            asChild: true,
            children: jsx('div', {
              className: 'min-h-0 flex flex-1 flex-col overflow-hidden',
              children: selectedRoute
                ? (view === 'projects'
                    ? jsx(ProjectBrowser, { route: selectedRoute }, routeKey(selectedRoute))
                    : jsx(SessionBrowser, { route: selectedRoute }, routeKey(selectedRoute)))
                : jsx('div', { className: `${hintStyle} p-3`, children: catalog.error || 'Choose a profile to browse.' })
            })
          }),
          jsxs(ContextMenuContent, {
            className: 'w-48',
            children: [
              jsxs(ContextMenuItem, {
                disabled: !selectedRoute,
                onSelect: () => selectedRoute && openWhereDialog(selectedRoute),
                children: [
                  jsx(Codicon, { name: 'add', size: '0.875rem' }),
                  jsx('span', { children: 'New session (choose location)…' })
                ]
              }),
              jsx(ContextMenuSeparator, {}),
              jsxs(ContextMenuItem, {
                disabled: !selectedRoute,
                onSelect: () => selectedRoute && invalidateRoute(selectedRoute),
                children: [
                  jsx(Codicon, { name: 'refresh', size: '0.875rem' }),
                  jsx('span', { children: 'Refresh' })
                ]
              })
            ]
          })
        ]
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
    setPluginContext(ctx)

    // Another Desktop window may change this plugin's stored state; drop the
    // parsed-tags cache and repaint. (ctx.storage keys carry this prefix.)
    if (typeof window !== 'undefined') {
      ctx.addEventListener?.(window, 'storage', (event) => {
        if (!event?.key || String(event.key).includes(`hermes.plugin.${ID}.`)) {
          invalidateTagsCache()
          bumpTagsRevision()
          bumpViewsRevision()
        }
      })
    }

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
      render: () => jsx(NavigatorShell, { onClose: closeNavigatorPage })
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
