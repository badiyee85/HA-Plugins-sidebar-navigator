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
  request: async () => ({}),
  requestProfile: undefined,
  profileRoutes: undefined,
  openSession: async () => {},
  ensureAgent: undefined,
  navigate: () => {},
  notify: () => {},
  notifyError: () => {}
}
export const icons = {}
export const queryClient = { invalidateQueries: async () => {} }
export const useQuery = () => ({ status: 'pending', data: null })
export const useValue = value => value?.get?.() ?? value
