# Executive Summary

The “Where would you like to create this session?” dialog already exists and works, but it is currently connected only to the Navigator header’s `+` button. The context-menu actions use different flows:

- The desktop-level **New session** action navigates directly to an unanchored Home chat.
- A project/session context-menu action may immediately create a session in the current project.
- Timeline session rows may not expose any new-session action at all.
- Empty Navigator space has no local context-menu trigger, so the event bubbles to the desktop shell.

The result is that right-clicking does not reliably expose the location chooser the user expects.

The architectural fix should introduce a shared, Navigator-scoped “choose location” action and expose it consistently through:

1. The Navigator header `+` button.
2. Session-row context menus.
3. Project-card context menus.
4. A Navigator-level context menu for empty space and list surfaces.
5. Any future Navigator entry points that need to create a session.

The existing **New session in `<Project>`** action should remain as an explicit fast path. It should not be conflated with the new **New session (choose location)…** action.

---

# Root Cause Analysis

## Code-Level Cause

`WhereDialog` already exists in `desktop-plugin/desktop/plugin.js`.

Conceptually, the current flow is:

```jsx
<WhereDialog
  open={whereOpen}
  onOpenChange={setWhereOpen}
  projects={projects}
  route={route}
/>
```

However, the state that controls it is only modified by the Navigator header:

```jsx
onClick: () => setWhereOpen(true)
```

No context-menu action calls `setWhereOpen(true)`.

### Current context-menu behavior

#### 1. Session row inside a project

A session row may expose:

```text
New session in <Project Name>
```

This directly calls:

```js
createSessionInProject(project, route)
```

That is a useful fast path, but it does not open `WhereDialog`.

#### 2. Session row in Home or without a project

There is no equivalent generic:

```text
New session
```

or:

```text
New session (choose location)…
```

action.

#### 3. Session row in Flat Timeline View

In `SessionBrowser`, the row is rendered without a `project` prop:

```jsx
<SessionRow
  session={s}
  focused={s.id === currentId}
  allProjects={allProjects}
  route={route}
/>
```

Therefore the project-specific context-menu branch evaluates false:

```js
project && !project.isNoProject
```

The row consequently has no new-session action at all.

#### 4. Project header card

The project card has:

```text
New session in <Project Name>
```

This directly creates a session in that project. Again, it does not ask the user to choose a location.

#### 5. Empty Navigator space

There is no root-level Radix `ContextMenu` or `ContextMenuTrigger` around:

- `NavigatorShell`
- `ProjectBrowser`
- `SessionBrowser`

Therefore, right-clicking empty space or unhandled list space allows the event to reach the desktop-level `AppContextMenu`.

The desktop-level item is:

```text
New session
```

but it performs a direct navigation to `NEW_CHAT_ROUTE`, which represents a generic Home/unanchored chat. It is not connected to `WhereDialog`.

---

## UX Flow Cause

The user reasonably interprets “New session” as:

> “Let me choose where this new session should be created.”

But the application currently has three different meanings for similar-looking actions:

| Entry point | Current behavior |
|---|---|
| Navigator `+` button | Opens location chooser |
| Project/session context menu | Creates directly in current project |
| Desktop shell context menu | Creates generic Home chat |
| Timeline session row | Often has no new-session action |

These actions are not visibly distinguished enough, and the location chooser is only available through a small, relatively undiscoverable button.

The result is inconsistent behavior:

- Right-clicking on a project may create a project session immediately.
- Right-clicking on a timeline row may show no new-session item.
- Right-clicking empty Navigator space may create a Home chat.
- Only the header `+` button displays the “Where?” dialog.

This is not primarily a dialog bug. It is an action-routing and context-menu ownership problem.

---

# Architectural Solution & Component Design

## 1. Introduce a Navigator-scoped shared “choose location” action

The location chooser should be controlled by state that is accessible to all Navigator descendants.

A suitable state shape is:

```ts
type WhereRequest = {
  open: boolean
  route?: string
}
```

Or, if the route is always derived from the active Navigator:

```ts
type WhereState = {
  open: boolean
}
```

A Jotai-style design could be:

```ts
export const whereOpenAtom = atom(false)
```

But this atom should be **scoped to the Navigator/profile instance**, not treated as a process-wide singleton with persisted state.

### Profile-safe recommendation

Prefer one of these designs:

#### Preferred: Navigator context with a scoped atom store

```tsx
<NavigatorStateProvider profileId={profileId}>
  <NavigatorShell />
</NavigatorStateProvider>
```

The provider owns the atom store or state instance. This prevents:

- One profile opening a dialog in another profile.
- A stale open state surviving profile changes.
- Multiple Navigator instances sharing an unintended dialog state.
- Dialog state being persisted as user data.

Conceptually:

```tsx
const NavigatorStateContext = createContext<NavigatorStateApi | null>(null)

type NavigatorStateApi = {
  openWhereDialog: () => void
  closeWhereDialog: () => void
  whereOpen: boolean
}
```

The header, rows, project cards, and root context menu all consume the same API.

#### Acceptable alternative: React context with local state

```tsx
const [whereOpen, setWhereOpen] = useState(false)

const openWhereDialog = useCallback(() => {
  setWhereOpen(true)
}, [])
```

Pass the action through a Navigator context rather than threading it through every row:

```tsx
<NavigatorActionsContext.Provider value={{ openWhereDialog }}>
  ...
</NavigatorActionsContext.Provider>
```

This is simpler and avoids introducing a new atom dependency if the plugin does not already use one.

### Important invariant

The state should be owned by the Navigator instance that renders `WhereDialog`. It should not be persisted to storage, indexed DB, URL state, or cross-profile global state.

When the profile, workspace, or Navigator instance changes:

```text
close the chooser and discard any pending request
```

This prevents a chooser opened in Profile A from appearing after switching to Profile B.

---

## 2. Centralize the action semantics

Create two explicit actions rather than allowing components to implement session creation independently.

```ts
type NavigatorSessionActions = {
  openWhereDialog: () => void
  createSessionInProject: (project: Project) => void
}
```

Potentially also expose:

```ts
type NavigatorSessionActions = {
  openWhereDialog: () => void
  createSessionAtHome: () => void
  createSessionInProject: (project: Project) => void
}
```

The important distinction is:

### Choose-location action

Label:

```text
New session (choose location)…
```

Behavior:

```text
openWhereDialog()
```

Then `WhereDialog` owns the final location selection.

### Project fast path

Label:

```text
New session in <Project Name>
```

Behavior:

```text
createSessionInProject(project, route)
```

This should not open the chooser.

### Why both should remain

The project-specific action is valuable for users who already know where they want the session. Removing it would add unnecessary friction.

The choose-location action is necessary when:

- The user is in Home.
- The user is in a mixed project/timeline view.
- The user is right-clicking empty space.
- The user wants to choose another project.
- The current row does not have a reliable project association.

---

## 3. Add the choose-location action to context menus

## SessionRow

Add a generic item to every session-row menu:

```text
New session (choose location)…
```

This should be present regardless of whether the row is:

- In a project.
- In Home.
- In flat timeline view.
- Missing an inferred project.

For a project row, the menu can contain both:

```text
New session in <Current Project>
New session (choose location)…
```

Recommended ordering:

```text
New session in <Current Project>
New session (choose location)…
────────────
New window
Rename…
...
```

Alternatively, place the generic item first if it is intended to be the primary action. The labels must make the difference clear.

Do not use the ambiguous label `New session` for the chooser if the desktop shell also uses that label for an immediate Home chat.

## ProjectCard

Keep:

```text
New session in <Project Name>
```

Add:

```text
New session (choose location)…
```

The first remains the direct project action. The second delegates to the shared Navigator action.

The generic item is useful even in a project card because the user may want to create the next session elsewhere.

## Navigator root/container menu

Add a root context menu around the Navigator’s interactive surface:

```text
New session (choose location)…
────────────
New window
...
```

This should cover:

- Empty space below the list.
- List background.
- Project browser background.
- Timeline background.
- Navigator chrome that does not already have a more specific context menu.

The root menu must not replace or duplicate the existing row and project-card menus.

---

## 4. Prevent Navigator right-clicks from falling through to `AppContextMenu`

The Navigator should own the `contextmenu` interaction for its bounds.

A Radix-style structure could be:

```jsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <div className="navigator-surface">
      ...
    </div>
  </ContextMenuTrigger>

  <ContextMenuContent>
    <ContextMenuItem onSelect={openWhereDialog}>
      New session (choose location)…
    </ContextMenuItem>
    ...
  </ContextMenuContent>
</ContextMenu>
```

Existing row-level context menus should remain nested or otherwise take precedence.

### Important implementation considerations

1. The root trigger should cover the actual Navigator surface.
2. It should not cover unrelated desktop areas.
3. Row triggers must continue to receive their own menus.
4. The root menu must not render two menus for one right-click.
5. The root menu should not appear when a row/project menu has already claimed the event.
6. Keyboard accessibility must remain intact; the root menu should be reachable through the normal context-menu keyboard gesture where supported.

If Radix nesting creates event conflicts, an explicit Navigator `onContextMenu` handler can be used to prevent bubbling only inside the Navigator, but this should be done carefully. The preferred solution is to use the existing context-menu primitives consistently rather than manually suppressing all propagation.

---

## 5. Decide how the desktop shell should interact

The desktop `AppContextMenu` does not necessarily need to change globally.

The desired behavior is:

- Right-click inside Navigator → Navigator-owned menu with chooser action.
- Right-click outside Navigator → existing desktop shell menu.
- Desktop shell “New session” retains its current behavior unless product requirements explicitly change it.

This limits regression risk and preserves existing desktop behavior.

However, the product team should make a deliberate decision about the desktop-level item:

### Option A: Preserve existing behavior

Keep:

```text
New session
```

as a direct Home/unanchored chat.

This is backward-compatible, but the distinction should be clear in labeling, for example:

```text
New session in Home
```

or:

```text
New chat
```

### Option B: Change the desktop shell item

Make the shell-level action open the location chooser as well.

This gives the product one consistent semantic for “New session,” but it requires coordination with the desktop application because the chooser currently belongs to the Navigator plugin.

If the dialog is plugin-owned, the shell should not directly import plugin internals. Instead, it could use a registered command/event interface such as:

```ts
desktopCommands.execute('navigator.newSessionChooseLocation')
```

That should be considered a separate desktop integration slice, not a prerequisite for fixing Navigator-local behavior.

---

# Detailed Implementation Plan

## Vertical Slice 1: Establish shared Navigator session actions

### Changes

Create a Navigator-level state/action provider or hook:

```ts
function useNavigatorSessionActions() {
  return {
    openWhereDialog,
    createSessionInProject,
  }
}
```

Provide it from `NavigatorShell`.

Move the existing header `+` behavior to use the shared action:

```tsx
onClick={openWhereDialog}
```

Keep `WhereDialog` rendered at a stable Navigator level, preferably near `NavigatorShell`, so it is not mounted/unmounted as the user switches browser modes.

### Invariants

- `openWhereDialog()` never creates a session immediately.
- `createSessionInProject(project)` never opens the chooser.
- Closing the dialog clears transient chooser state.
- Switching profile or Navigator instance closes the dialog.

---

## Vertical Slice 2: Add chooser action to `SessionRow`

### Changes

Add:

```text
New session (choose location)…
```

to every SessionRow context menu.

Use the shared action:

```tsx
onSelect={openWhereDialog}
```

Retain the project-specific item when a valid project is known:

```tsx
onSelect={() => createSessionInProject(project)}
```

### Timeline handling

Do not require `SessionRow` to know the project merely to expose the generic chooser action.

That means the generic item works correctly even when `project` is undefined in the flat timeline.

Optionally, improve project inference later by resolving the session’s project from `allProjects`, but that is not required for the chooser fix.

---

## Vertical Slice 3: Add chooser action to `ProjectCard`

### Changes

Keep the current fast-path action:

```text
New session in <Project Name>
```

Add:

```text
New session (choose location)…
```

Both actions should use the centralized Navigator action API.

### Validation

Verify that the project-specific action still:

- Uses the correct project ID.
- Preserves the current route behavior.
- Does not accidentally route through `WhereDialog`.

---

## Vertical Slice 4: Add a Navigator-level context menu

### Changes

Wrap the appropriate Navigator surface with a root context-menu trigger.

Candidate ownership:

```text
NavigatorShell
├── ProjectBrowser
├── SessionBrowser
└── WhereDialog
```

The root trigger should be placed as high as possible while remaining limited to Navigator bounds.

Add:

```text
New session (choose location)…
```

to the root menu.

Optionally include the same desktop-safe utility items that are useful inside Navigator, such as:

```text
New window
```

but avoid duplicating the entire `AppContextMenu` unless there is a clear requirement.

### Event behavior

Test these areas independently:

- Empty space below project cards.
- Empty space below timeline rows.
- Timeline row.
- Project row.
- Navigator header.
- Scrollbar-adjacent list area.
- Navigator padding and separators.

The expected result is that all Navigator-owned right-clicks either:

- Open the relevant row/project menu, or
- Open the Navigator root menu with the chooser action.

None should fall through to the desktop shell menu.

---

## Vertical Slice 5: Make `WhereDialog` profile-safe

### Changes

Ensure the dialog is mounted under the correct profile/Navigator state owner.

On profile or route changes:

```ts
useEffect(() => {
  closeWhereDialog()
}, [profileId])
```

If `route` is captured when opening, use a request object:

```ts
type WhereRequest = {
  route: string
}
```

This avoids using a stale route if the user changes Navigator context while the dialog is open.

At minimum:

- Derive the current route at selection time.
- Validate that the selected project still exists.
- Disable or safely handle deleted/unavailable projects.
- Do not create a session against a stale profile.

---

## Vertical Slice 6: Optional desktop command integration

This is optional but should be documented.

If the desired product behavior is that the desktop shell’s own “New session” also opens the chooser, expose a narrow command boundary rather than importing plugin UI into the desktop shell.

For example:

```ts
navigatorCommands.register('new-session-choose-location', openWhereDialog)
```

Then `AppContextMenu` can invoke the command if the Navigator is available.

Fallback behavior should remain safe:

```text
If Navigator command is unavailable, preserve the existing direct Home-chat behavior.
```

This maintains backward compatibility for plugin-disabled or older desktop configurations.

---

# Verification & Test Strategy

## Unit tests

### Shared action tests

Verify:

- `openWhereDialog()` changes only chooser state.
- `createSessionInProject()` directly creates a project session.
- The two actions are not interchangeable.
- Opening the chooser does not call session-creation APIs.
- Closing the chooser clears transient state.

### `SessionRow` tests

For a row with a project:

- Shows `New session in <Project>`.
- Shows `New session (choose location)…`.
- Project item creates directly in the project.
- Generic item opens the chooser.

For a row without a project:

- Shows `New session (choose location)…`.
- Does not render an invalid `New session in undefined`.
- Generic item opens the chooser.

For a timeline row:

- Same generic chooser behavior is available even when `project` is not passed.

### `ProjectCard` tests

Verify:

- Project fast path remains present.
- Chooser item is present.
- Fast path and chooser invoke different callbacks.

---

## Context-menu integration tests

Simulate right-clicking:

1. Navigator empty space.
2. Navigator list background.
3. A timeline row.
4. A project card.
5. Home session row.
6. Project session row.
7. Navigator header.
8. Outside the Navigator.

Expected results:

| Location | Expected menu |
|---|---|
| Navigator empty space | Navigator root menu |
| Timeline row | Session-row menu |
| Project session row | Session-row menu |
| Project card | Project-card menu |
| Outside Navigator | Desktop `AppContextMenu` |
| Any Navigator menu | Includes chooser action where applicable |

Explicitly verify that right-clicking Navigator space does not open the desktop shell’s unanchored Home action.

---

## Dialog behavior tests

Verify:

- Selecting Home creates an unanchored/Home session.
- Selecting a project creates a session in that project.
- Cancel closes without creating a session.
- Escape closes without creating a session.
- Reopening after cancel starts with clean state.
- Switching profile while open closes or safely resets the dialog.
- A deleted or unavailable project cannot be selected.
- Multiple Navigator instances do not share open state accidentally.

---

## Regression tests

Preserve existing behavior for:

- Rename.
- Pin.
- Mark read/unread.
- Appearance.
- Copy ID.
- Tags.
- Branch.
- Export.
- Move to project.
- Archive.
- Delete.
- New window.
- Project cockpit actions.
- Desktop shell context menu outside Navigator.

---

## `AGENTS.md` invariants

Document the following architectural rules in `AGENTS.md`:

### Session creation semantics

1. **Choose-location action**
   - Opens `WhereDialog`.
   - Must not create a session directly.

2. **Project fast-path action**
   - Creates directly in the specified project.
   - Must not open `WhereDialog`.

3. **Desktop shell action**
   - Must have an explicitly documented meaning: either direct Home chat or chooser-backed creation.
   - It must not silently diverge from the Navigator semantics.

### State ownership

4. `WhereDialog` state is Navigator-scoped and profile-safe.
5. It must not be persisted as user data.
6. Profile changes must close or reset the dialog.
7. Session creation must use the active profile and valid route.

### Context-menu ownership

8. Right-clicks within Navigator must not fall through to `AppContextMenu`.
9. Row and project-card menus retain precedence over the root Navigator menu.
10. The root Navigator menu must be limited to Navigator bounds.
11. Every Navigator surface that supports session creation must expose either:
    - A project fast path,
    - The chooser action,
    - Or both.

### Labeling

12. Do not label an immediate Home/unanchored action merely as `New session` if a chooser-backed action is also available.
13. Use explicit labels:
    - `New session in <Project>`
    - `New session (choose location)…`

---

The core fix is to treat “choose where” as a Navigator-wide command rather than a header-button-only implementation. Once that command is shared and Navigator owns its right-click surface, the user gets consistent behavior without sacrificing the efficient project-specific fast path or changing unrelated desktop context-menu behavior.