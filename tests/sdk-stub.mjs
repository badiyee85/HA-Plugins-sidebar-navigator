const makeAtom = value => ({ get: () => value, set: next => { value = next } })
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar'
export const PALETTE_AREA = 'palette'
export const KEYBINDS_AREA = 'keybinds'
export const Button = 'Button'
export const Codicon = 'Codicon'
export const ColorSwatches = 'ColorSwatches'
export const ConfirmDialog = 'ConfirmDialog'
export const ContextMenu = 'ContextMenu'
export const ContextMenuContent = 'ContextMenuContent'
export const ContextMenuItem = 'ContextMenuItem'
export const ContextMenuSeparator = 'ContextMenuSeparator'
export const ContextMenuSub = 'ContextMenuSub'
export const ContextMenuSubContent = 'ContextMenuSubContent'
export const ContextMenuSubTrigger = 'ContextMenuSubTrigger'
export const ContextMenuTrigger = 'ContextMenuTrigger'
export const Dialog = 'Dialog'
export const DialogContent = 'DialogContent'
export const DialogFooter = 'DialogFooter'
export const DialogHeader = 'DialogHeader'
export const DialogTitle = 'DialogTitle'
export const Input = 'Input'
export const PROFILE_SWATCHES = []
export function profileColor(name) {
  const key = String(name ?? '').trim()
  if (!key || key === 'default') return null
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  return `hsl(${hue} 68% 58%)`
}
export function profileColorSoft(color, percent = 16) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}
export const SessionStatusDot = ({ storedSessionId, session, className }) => ({
  type: 'SessionStatusDot',
  props: { storedSessionId, session, className }
})
export const atom = makeAtom
export const haptic = () => {}
export const host = {
  state: {
    connectionId: makeAtom('local'),
    profile: makeAtom('default'),
    focusedSessionOwner: makeAtom({ connectionId: 'local', profile: 'default' }),
    focusedStoredSessionId: makeAtom(''),
    busy: makeAtom(false),
    awaitingResponse: makeAtom(false),
    busyBySession: makeAtom({})
  },
  request: async (method, params) => {
    if (activeRouteMockHandler) return activeRouteMockHandler(method, params)
    return {}
  },
  requestProfile: async (connectionId, profile, method, params) => {
    if (activeRouteMockHandler) return activeRouteMockHandler(method, params, { connectionId, profile })
    return {}
  },
  profileRoutes: undefined,
  openSession: async (sessionId, options) => {
    host.lastOpenedSession = { sessionId, options }
  },
  ensureAgent: undefined,
  navigate: (path) => {
    host.lastNavigated = path
  },
  notify: (notification) => {
    host.lastNotification = notification
  },
  notifyError: (err, title) => {
    host.lastNotificationError = { err, title }
  }
}

let activeRouteMockHandler = null
export function setRouteMockHandler(handler) {
  activeRouteMockHandler = handler
}
export function resetRouteMocks() {
  activeRouteMockHandler = null
  delete host.lastOpenedSession
  delete host.lastNavigated
  delete host.lastNotification
  delete host.lastNotificationError
}
export const icons = {}
export const queryClient = { invalidateQueries: async () => {} }
export const useQuery = () => ({ status: 'pending', data: null })
export const useValue = value => value?.get?.() ?? value
