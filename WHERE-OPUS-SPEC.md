# Engineering Specification: Navigator “Where” Context Menu & Location Chooser

## 1. Navigator session-action state and primitives

### 1.1 State model

Use a single request atom rather than a boolean-only atom. The route must be retained because the chooser may be opened from a Navigator surface whose route differs from the currently selected session.

```js
export const whereStateAtom = atom({
  open: false,
  route: null,
})
```

Expose derived atoms for simple consumers and tests:

```js
export const whereOpenAtom = atom(
  (get) => get(whereStateAtom).open,
  (_get, set, open) => {
    set(whereStateAtom, (state) => ({
      ...state,
      open: Boolean(open),
    }))
  },
)

export const whereRouteAtom = atom(
  (get) => get(whereStateAtom).route,
  (_get, set, route) => {
    set(whereStateAtom, (state) => ({
      ...state,
      route: route ?? null,
    }))
  },
)
```

`whereStateAtom` is the canonical state. Do not maintain separate, independently writable `whereOpen` and route state.

### 1.2 Action atoms

Add write-only action atoms so all Navigator descendants use the same behavior:

```js
export const openWhereDialogAtom = atom(
  null,
  (_get, set, route = null) => {
    set(whereStateAtom, {
      open: true,
      route: route ?? null,
    })
  },
)

export const closeWhereDialogAtom = atom(
  null,
  (_get, set) => {
    set(whereStateAtom, {
      open: false,
      route: null,
    })
  },
)
```

The component-facing API should be exposed through a hook:

```js
export function useNavigatorSessionActions() {
  const open = useSetAtom(openWhereDialogAtom)
  const close = useSetAtom(closeWhereDialogAtom)

  return useMemo(() => ({
    openWhereDialog: (route = null) => open(route),
    closeWhereDialog: () => close(),
  }), [open, close])
}
```

All of the following must consume this hook or an equivalent Navigator context:

- `NavigatorShell`
- `SessionRow`
- `ProjectCard`
- Navigator root context-menu content

Do not pass `setWhereOpen` through multiple row/card props.

### 1.3 Atom scope

The atoms must be scoped to the Navigator/profile instance.

Preferred implementation:

```jsx
<JotaiProvider store={navigatorStore}>
  <NavigatorShell ... />
</JotaiProvider>
```

Create the store when the Navigator/profile instance is created. Do not persist `whereStateAtom`.

When the profile, workspace, or Navigator instance changes, reset the state:

```js
set(whereStateAtom, { open: false, route: null })
```

If this plugin already uses a profile-scoped atom store, add the new atoms to that existing store. Do not introduce a process-wide singleton state if multiple profiles can be mounted simultaneously.

### 1.4 WhereDialog integration

`NavigatorShell` remains the owner and renderer of `WhereDialog`:

```jsx
const whereOpen = useAtomValue(whereOpenAtom)
const whereRoute = useAtomValue(whereRouteAtom)
const { closeWhereDialog } = useNavigatorSessionActions()

<WhereDialog
  open={whereOpen}
  onOpenChange={(open) => {
    if (!open) closeWhereDialog()
  }}
  projects={projects}
  route={whereRoute ?? route}
/>
```

Required behavior:

- `openWhereDialog(route)` sets `{ open: true, route }`.
- If no route is supplied, `WhereDialog` receives the active Navigator route.
- Closing the dialog clears both `open` and `route`.
- Selecting a location continues to use the existing `WhereDialog` creation/navigation behavior.
- Do not create a second dialog instance in rows or cards.

The existing header `+` button must be changed to call:

```js
openWhereDialog(route)
```

instead of maintaining separate local dialog state.

---

## 2. Explicit session actions

Keep the existing direct project fast path separate from the chooser action.

### 2.1 Choose-location action

Canonical label:

```text
New session (choose location)…
```

Behavior:

```js
openWhereDialog(route)
```

This action must never directly navigate to `NEW_CHAT_ROUTE`.

### 2.2 Project fast path

Canonical label:

```text
New session in <Project Name>
```

Behavior:

```js
createSessionInProject(project, route)
```

This remains an immediate project creation flow and must not open `WhereDialog`.

### 2.3 Existing desktop shell behavior

Do not change the desktop-level `AppContextMenu` in this feature. Its existing unanchored/Home behavior remains unchanged outside Navigator bounds.

Navigator right-clicks must be claimed by Navigator-owned menus before they reach the desktop shell.

---

## 3. `SessionRow` context menu

### 3.1 Required menu items

Every `SessionRow` must expose:

```text
New session (choose location)…
```

This item is unconditional. It must appear for:

- Project sessions.
- Home sessions.
- Flat timeline sessions.
- Rows without an inferred project.
- Rows rendered without a `project` prop.

When a valid project exists, also expose:

```text
New session in <Project Name>
```

The project item is shown only when:

```js
project && !project.isNoProject
```

Recommended ordering:

```text
New session in <Project Name>       // conditional
New session (choose location)…      // always present
────────────────────────────
existing items
```

### 3.2 Item implementation

The generic item must use the `add` Codicon and invoke the shared action:

```jsx
<ContextMenuItem
  onSelect={() => openWhereDialog(route)}
>
  <Codicon name="add" />
  New session (choose location)…
</ContextMenuItem>
```

The project item continues to use the existing project creation helper:

```jsx
<ContextMenuItem
  onSelect={() => createSessionInProject(project, route)}
>
  <Codicon name="add" />
  New session in {project.name}
</ContextMenuItem>
```

Do not infer a project from `allProjects` solely to decide whether to show the fast path unless the existing row architecture already has a deterministic project resolver. The generic chooser item must not depend on project inference.

### 3.3 Required `SessionRow` inputs

`SessionRow` must have access to:

- `route`
- Existing `project`, if available
- `openWhereDialog` through Navigator action context/hook

Do not make `project` mandatory. Timeline and Home callers must continue to render correctly.

---

## 4. `ProjectCard` context menu

### 4.1 Required menu items

Keep the existing fast path:

```text
New session in <Project Name>
```

Add:

```text
New session (choose location)…
```

Both items must be available on a project card.

### 4.2 Behavior

Fast path:

```js
createSessionInProject(project, route)
```

Chooser path:

```js
openWhereDialog(route)
```

The chooser action must remain available even when the context menu originates from a project card, because the user may want to create the next session in another project or Home.

Use the `add` Codicon for both new-session actions if that matches existing menu conventions.

---

## 5. Navigator root context menu

### 5.1 Scope

Wrap the Navigator list/background surface with a root Radix context menu. The trigger must cover:

- Empty space below Navigator entries.
- Project browser background.
- Timeline background.
- Unclaimed list surface.

It should not cover unrelated desktop content.

Conceptual structure:

```jsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <div className="navigator-list-surface">
      {children}
    </div>
  </ContextMenuTrigger>

  <ContextMenuContent>
    ...
  </ContextMenuContent>
</ContextMenu>
```

The header may be included only if it is not already covered by another context-menu surface. Avoid overlapping triggers unnecessarily.

### 5.2 Root menu items

Required items:

```text
New session (choose location)…
Refresh
```

Implementation:

```jsx
<ContextMenuItem
  onSelect={() => openWhereDialog(route)}
>
  <Codicon name="add" />
  New session (choose location)…
</ContextMenuItem>

<ContextMenuItem
  onSelect={onRefresh}
>
  <Codicon name="refresh" />
  Refresh
</ContextMenuItem>
```

`onRefresh` must call the existing Navigator refresh/reload mechanism. Do not introduce a second refresh implementation.

### 5.3 Prevent desktop-menu fallthrough

Right-clicking inside the Navigator must not open the desktop shell `AppContextMenu`.

The implementation must satisfy all of the following:

1. Root Navigator surface claims unhandled `contextmenu` events.
2. Row and project-card menus remain higher priority.
3. A row/project right-click opens only its specific menu.
4. Empty Navigator space opens only the Navigator root menu.
5. Right-clicking outside Navigator continues to use `AppContextMenu`.

If nested Radix triggers bubble the native `contextmenu` event to the root trigger, mark row/project triggers and stop propagation at the specific trigger boundary:

```jsx
<ContextMenuTrigger
  asChild
  onContextMenu={(event) => {
    event.stopPropagation()
  }}
>
  ...
</ContextMenuTrigger>
```

Use this only on specific Navigator item triggers, not on the entire Navigator surface.

If the existing context-menu abstraction already handles nested triggers, use its established mechanism instead of adding duplicate propagation logic. Do not globally suppress `contextmenu` events from `NavigatorShell`, as that can interfere with keyboard/accessibility behavior.

---

## 6. Public exports and test contract

Add or export the following from the plugin module or its testable state module:

```js
export const whereStateAtom
export const whereOpenAtom
export const whereRouteAtom
export const openWhereDialogAtom
export const closeWhereDialogAtom
export function useNavigatorSessionActions()
```

The hook returns:

```js
{
  openWhereDialog(route),
  closeWhereDialog(),
}
```

If the codebase requires direct action creators for tests, additionally export pure action creators:

```js
export const openWhereDialogAction = (route = null) => ({
  type: 'navigator/openWhereDialog',
  route,
})

export const closeWhereDialogAction = () => ({
  type: 'navigator/closeWhereDialog',
})
```

These are optional if tests can invoke the Jotai write atoms directly.

### 6.1 Required tests in `tests/where-dialog-menu.test.mjs`

Test state behavior:

1. Initial state is:
   ```js
   { open: false, route: null }
   ```
2. `openWhereDialogAtom` sets `open: true`.
3. A supplied route is retained.
4. A missing route produces `route: null`.
5. `closeWhereDialogAtom` resets both fields.
6. Closing through `WhereDialog.onOpenChange(false)` clears the request.
7. A new profile/Navigator store does not inherit another profile’s open state.

Test menu behavior:

8. `SessionRow` always renders `New session (choose location)…`.
9. `SessionRow` renders the project fast path only for a valid, non-`isNoProject` project.
10. Timeline/Home rows still render the generic chooser item without a project.
11. Selecting the chooser item invokes `openWhereDialog(route)`.
12. Selecting the project item invokes `createSessionInProject(project, route)` and does not open the chooser.
13. `ProjectCard` renders both actions.
14. Navigator root menu renders chooser and Refresh.
15. Selecting root chooser invokes `openWhereDialog(route)`.
16. Selecting Refresh invokes the existing refresh callback.
17. Navigator right-clicks do not invoke the desktop shell context-menu handler.
18. Row/project right-clicks do not additionally open the Navigator root menu.
19. Right-clicking outside Navigator remains delegated to `AppContextMenu`.

Use accessible menu text as the primary assertion target. Treat Codicon rendering as a secondary assertion; verify that the chooser item uses the `add` icon if the test utilities support icon inspection.

---

## 7. Acceptance criteria

The implementation is complete when:

- Header `+`, session rows, project cards, and Navigator empty space all open the same `WhereDialog`.
- The chooser is controlled by one Navigator-scoped state source.
- Project fast-path creation remains immediate and unchanged.
- Timeline and Home rows always expose the generic chooser action.
- Navigator right-clicks never fall through to the desktop shell menu.
- Desktop shell behavior outside Navigator is unchanged.
- Dialog state is not persisted and cannot leak between profiles.
- All listed state, menu, routing, and propagation tests pass.