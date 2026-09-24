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
  activeRouteFrom,
  addSessionTag,
  createSessionInProject,
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
        routeCatalogExpiresAt = Date.now() + ROUTE_CACHE_TTL_MS
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
    if (!current) throw new Error('The selected profile route is no longer available. Refresh Navigator.')
    return current
  }
  return normalized
}

async function requestForRoute(route, method, params = {}, transportHost = host, owner = undefined, options = {}) {
  const normalized = await routeForRequest(route, transportHost, Boolean(options.fresh))
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

const viewAtom = atom('projects')
const queryAtom = atom('')
const browseStateAtom = atom({ manual: false, selected: null, unavailable: null })

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

function isSessionPinned(sessionId, session, route) {
  if (session?.pinned === true) return true
  return readIdList(storageKey('hermes.desktop.pinnedSessions', route)).includes(sessionId)
}

function getSessionColorOverride(sessionId, route) {
  try {
    const key = storageKey('hermes.desktop.sessionColors', route)
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(key) : null
    if (raw) {
      const map = JSON.parse(raw)
      if (map && map[sessionId]) return map[sessionId]
    }
  } catch {}
  return null
}

function setSessionColorOverride(sessionId, color, route) {
  try {
    const key = storageKey('hermes.desktop.sessionColors', route)
    if (!key) return
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(key) : null
    const map = raw ? JSON.parse(raw) || {} : {}
    if (color) {
      map[sessionId] = color
    } else {
      delete map[sessionId]
    }
    window.localStorage?.setItem(key, JSON.stringify(map))
    window.dispatchEvent(new StorageEvent('storage', {
      key,
      newValue: JSON.stringify(map)
    }))
  } catch (err) {
    console.warn('Failed to update session color override', err)
  }
}

// Hermes' public gateway RPC surface has no route-aware pin/read verbs. Keep
// these presentation-only controls route-qualified rather than falling back to
// a private REST bridge or an active-gateway request, which could mutate the
// wrong source when duplicate session ids exist.
function readIdList(key) {
  if (!key || typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeIdList(key, list) {
  if (!key || typeof window === 'undefined') return false
  const value = JSON.stringify(list)
  window.localStorage?.setItem(key, value)
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }))
  return true
}

async function toggleSessionPin(sessionId, currentlyPinned, route) {
  const key = storageKey('hermes.desktop.pinnedSessions', route)
  const list = readIdList(key)
  const next = currentlyPinned
    ? list.filter(id => id !== sessionId)
    : [sessionId, ...list.filter(id => id !== sessionId)]
  if (!writeIdList(key, next)) throw new Error('Pinned session storage is unavailable.')
  return !currentlyPinned
}

async function toggleSessionUnread(sessionId, currentlyUnread, route) {
  const key = storageKey('hermes.desktop.unreadSessions', route)
  const list = readIdList(key)
  const next = currentlyUnread
    ? list.filter(id => id !== sessionId)
    : [sessionId, ...list.filter(id => id !== sessionId)]
  if (!writeIdList(key, next)) throw new Error('Unread session storage is unavailable.')
  return !currentlyUnread
}

// ─── Session Tags Storage & Utilities ────────────────────────────────────────

const TAGS_STORAGE_BASE = 'hermes.desktop.sessionTags'
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

function readSessionTagsMap(route) {
  const key = tagsKey(route)
  if (!key) return {}
  try {
    const raw = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(key)
      : (typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage.getItem(key) : null)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const cleanMap = {}
      for (const [id, list] of Object.entries(parsed)) {
        const clean = sanitizeTagList(list)
        if (clean.length) cleanMap[id] = clean
      }
      return cleanMap
    }
    return {}
  } catch {
    return {}
  }
}

function writeSessionTagsMap(route, map) {
  const key = tagsKey(route)
  if (!key) return
  const cleanMap = {}
  for (const [id, list] of Object.entries(map || {})) {
    const clean = sanitizeTagList(list)
    if (clean.length) cleanMap[id] = clean
  }
  try {
    const storage = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : (typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null)
    if (storage) {
      if (Object.keys(cleanMap).length === 0) {
        storage.removeItem(key)
      } else {
        storage.setItem(key, JSON.stringify(cleanMap))
      }
    }
  } catch (err) {
    console.warn('[ha-sidebar-navigator] Failed to write session tags:', err)
  }
  bumpTagsRevision()
}

function getSessionTags(sessionId, route) {
  if (!sessionId) return []
  const map = readSessionTagsMap(route)
  return map[sessionId] || []
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
  const map = readSessionTagsMap(route)
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
  const assignedTags = sessionId ? getSessionTags(sessionId, route) : []
  const availableTags = getAllRouteTags(route)

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
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(sessionId).then(() => {
      host.notify({ kind: 'success', message: 'Session ID copied to clipboard' })
    }).catch(err => host.notifyError?.(err, 'Failed to copy session ID'))
  } else if (typeof window !== 'undefined' && window.hermesDesktop?.writeClipboard) {
    window.hermesDesktop.writeClipboard(sessionId)
    host.notify({ kind: 'success', message: 'Session ID copied to clipboard' })
  }
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

async function branchSession(session, route) {
  host.notify({ kind: 'info', message: 'Branching session…' })
  try {
    const result = await mutateForRoute(route, 'session.branch', { session_id: session.id })
    const newId = result?.stored_session_id || result?.session_key || result?.session_id
    if (!newId) throw new Error('Branch did not return a session id')
    invalidateRoute(route)
    await openSessionForRoute(route, newId)
    host.notify({ kind: 'success', message: 'Branched to new session' })
  } catch (err) {
    host.notifyError?.(err, 'Failed to branch session')
  }
}

async function exportSession(session, route) {
  host.notify({ kind: 'info', message: 'Preparing session export…' })
  try {
    const result = await requestForRoute(route, 'session.history', { session_id: session.id })
    const messages = result?.messages || []
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

function WhereDialog({ open, onOpenChange, projects = [], route }) {
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
            jsx(DialogTitle, { children: 'Start New Session' }),
            jsx('p', {
              className: 'text-xs text-(--ui-text-quaternary) mt-0.5',
              children: 'Where would you like to create this session?'
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
            (!q || 'home'.includes(q)) ? jsx('button', {
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

            (filteredProjects.length === 0 && (!q || !'home'.includes(q))) ? jsx('div', {
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
  const [unread, setUnread] = useState(() => {
    if (session.unread) return true
    try {
      const raw = typeof window !== 'undefined'
        ? window.localStorage?.getItem(storageKey('hermes.desktop.unreadSessions', route))
        : null
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) && list.includes(session.id)
    } catch {
      return false
    }
  })
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
      await mutateForRoute(route, 'session.title', { session_id: session.id, title: next })
      invalidateRoute(route)
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

  const sessionProfile = resolveSessionProfile(session, route)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  useValue(tagsRevisionAtom)
  const sessionTags = session.id ? getSessionTags(session.id, route) : []

  const rowButton = jsxs('button', {
    type: 'button',
    className: isCurrent ? rowBtnActive : rowBtn,
    onClick: () => void openSessionSafely(route, session.id),
    title: session.title || session.preview || session.id,
    children: [
      isBusy ? jsx('span', { 'aria-hidden': 'true', className: 'arc-border arc-row' }) : null,
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
              // New session in this project (if within project)
              (project && !project.isNoProject) ? jsxs(ContextMenuItem, {
                onSelect: () => void createSessionInProject(project, route),
                children: [
                  jsx(Codicon, { name: 'add', size: '0.875rem' }),
                  jsx('span', { children: `New session in ${project.label || project.name || project.id}` })
                ]
              }) : null,
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
        onConfirm: () => deleteSession(session.id, route)
      }),
      // Tag Management Dialog
      jsx(TagDialog, {
        open: tagDialogOpen,
        onOpenChange: setTagDialogOpen,
        session,
        route
      })
    ]
  })
}

// ── Sessions Flattened View ──────────────────────────────────────────────────

function SessionBrowser({ route }) {
  useValue(tagsRevisionAtom)
  const q = useValue(queryAtom).trim()
  const currentId = useValue(focusAtom)
  const tagsMap = readSessionTagsMap(route)

  const listQuery = useQuery({
    queryKey: queryKey('sessions', route),
    queryFn: () => requestForRoute(route, 'session.list', { limit: SESSIONS_LIMIT }),
    enabled: Boolean(route),
    refetchInterval: 15000,
    staleTime: 5000
  })

  const treeQuery = useQuery({
    queryKey: queryKey('projects-tree', route),
    queryFn: () => requestForRoute(route, 'projects.tree', { preview_limit: TREE_PREVIEW_LIMIT }),
    enabled: Boolean(route),
    staleTime: 8000
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

  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col overflow-hidden',
    children: [
      jsx(TagFilterBar, { route, className: 'px-2 pb-1 border-b border-(--ui-stroke-secondary)' }),
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
          jsx(SessionRow, { session: s, focused: s.id === currentId, allProjects, route }, rowKey(route, s.id))
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

function ProjectCard({ project, allProjects, currentId, filterQuery, route }) {
  const [expanded, setExpanded] = useState(true)
  const [loadAll, setLoadAll] = useState(false)

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

  const tagsMap = readSessionTagsMap(route)

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
              jsxs(ContextMenuItem, {
                onSelect: () => void createSessionInProject(project, route),
                children: [
                  jsx(Codicon, { name: 'add', size: '0.875rem' }),
                  jsx('span', { children: `New session in ${projectLabel}` })
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
                onSelect: () => {
                  if (typeof window !== 'undefined' && window.hermesDesktop?.writeClipboard) {
                    window.hermesDesktop.writeClipboard(projectCwd)
                  } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(projectCwd)
                  }
                  host.notify({ kind: 'success', message: 'Project path copied to clipboard' })
                },
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
                : sessions.map((s) =>
                    jsx(SessionRow, { session: s, focused: s.id === currentId, project, allProjects, route }, `${project.id}/${rowKey(route, s.id)}`)
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

function NavigatorShell() {
  const view = useValue(viewAtom)
  const q = useValue(queryAtom)
  const profile = useValue(host.state.profile)
  const connectionId = host.state.connectionId ? useValue(host.state.connectionId) : ''
  const browse = useValue(browseStateAtom)
  const catalog = useRouteCatalog(connectionId, profile)
  const activeRoute = activeRouteFrom(catalog.routes, connectionId, profile)
  const selectedRoute = browse.selected || (!browse.manual ? activeRoute : null)
  const [whereOpen, setWhereOpen] = useState(false)

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
                    className: chipBtn,
                    disabled: !selectedRoute,
                    title: 'New session (choose location)',
                    onClick: () => setWhereOpen(true),
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
          })
        ]
      }),
      jsx(WhereDialog, {
        open: whereOpen,
        onOpenChange: setWhereOpen,
        projects: availableProjects,
        route: selectedRoute
      }),
      jsx('div', {
        className: 'min-h-0 flex flex-1 flex-col overflow-hidden',
        children: selectedRoute
          ? (view === 'projects'
              ? jsx(ProjectBrowser, { route: selectedRoute }, routeKey(selectedRoute))
              : jsx(SessionBrowser, { route: selectedRoute }, routeKey(selectedRoute)))
          : jsx('div', { className: `${hintStyle} p-3`, children: catalog.error || 'Choose a profile to browse.' })
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
