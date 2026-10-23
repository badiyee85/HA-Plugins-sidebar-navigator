# PROJECT.md — Hermes Sidebar Navigator

## Overview
- **Name:** HA-Plugins-sidebar-navigator
- **Plugin ID:** `ha-sidebar-navigator`
- **Maintainer:** Bobby (for Badi)
- **Primary Lane:** `badiyee85`
- **Target Surface:** Hermes Desktop App (`desktop-plugins/ha-sidebar-navigator/plugin.js`)

## Features (v0.9.0)
- Complete project session lists without the 3-item truncation (up to 2,000 sessions per project).
- Search across all projects and sessions (title, preview, ID).
- Projects view and chronological Timeline view.
- Profile/connection browsing via the *Browse profile* selector, with legacy single-profile fallback and surfaced backend error reasons.
- Direct navigation to any session; expandable / collapsible project blocks.
- Live session status dots and profile identity badges (v0.4–0.5).
- Session tagging with colour-coded pills and a tag filter bar (v0.6).
- Context menus on sessions, projects, and the Navigator root; Where chooser for starting a session in Home or a chosen project (v0.7).
- Bulk select mode (v0.8): multi-select across a project or the Timeline, then tag / move / archive / delete in one action. Per-profile scope, running sessions skipped, partial failures stay selected.
- Saved views (v0.9): named filter + Projects/Timeline mode, per profile in `ctx.storage` (`views` key), max 20, update-in-place on same name. Logic (`saveView`, `deleteView`, `sanitizeViews`, `applyView`) is plain exported functions; `SavedViewsBar` / `SaveViewDialog` are thin UI.
- Session actions: rename, pin, unread, colour, copy ID, branch, export, move to project, archive, delete, open in new window.

## Backend contract (verified against the real gateway)
- Stored session ids (what the Navigator lists) are rejected with `4001 session not found` by calls that act on a *live* session: `session.title`, `session.history`, `session.branch`. The plugin therefore goes through `withStoredSession`: borrow the live handle from `session.active_list` if the session is already open, otherwise `session.resume` (lazy) it, do the work, and `session.close` it. It never closes a handle it did not open, because resuming an already-open session returns the user's own runtime id.
- Branch uses `session.branch_stored` with `parent_session_id`. Archive, delete, move and create accept stored ids directly.
- `tests/live-backend.test.mjs` exercises every one of these against the real gateway handlers in a throwaway `HERMES_HOME` (`tests/live/`). It skips, with a reason, when no Hermes checkout with a working Python is found; set `HERMES_AGENT_DIR` / `HERMES_AGENT_PYTHON` to point at one. Mocked tests cannot catch this class of bug; keep adding a live test for any new backend call.

## Persistence & host boundaries (v0.8.1)
- Navigator state (tags, pins, colours, unread) is stored only in `ctx.storage`, keyed per profile route. No raw `localStorage` writes and no synthetic `StorageEvent`s. The single remaining `localStorage` access is a one-time read-and-delete that imports tags saved by pre-0.8.1 builds.
- Real sidebar pin/colour changes go through `host.sessions.pin` / `host.sessions.setColor`, only when the route is the profile Desktop is showing. Unread has no public verb, so it stays Navigator-only.
- Clipboard goes through `ctx.os.writeClipboard`, with `navigator.clipboard` as the fallback. Never `window.hermesDesktop.*`.

## Performance notes (v0.8.2)
- Rows ask for pins, colours, unread marks and tags on every render. `ctx.storage` parses JSON on every `get`, so reads go through a read-through cache (`withReadCache`) and parsed tag maps are cached per route (`tagsMapFor`, treat as read-only; `readSessionTagsMap` returns a private copy). Writes update the cache; a `storage` event from another window drops it. This took a 500-row Timeline with 400 tagged sessions from about 6 s of render work to about 15 ms.
- Rename / delete / tag dialogs mount only while open. The Timeline and expanded projects mount `ROW_PAGE_SIZE` (100) rows with a *Show more* button.
- The Timeline's project list (Move menu) uses `projects.tree` with `preview_limit: 1` under its own query key (`projects-list`), never the Projects view's `projects-tree` entry.
- The full-page route has its own Close button (history back, else home). The docked pane relies on the app's pane chrome.

## Registration surfaces
- Left-rail pane (`navigator-pane`), full page route `/navigator`, sidebar nav item, and command-palette action *Sidebar Navigator: Open All Projects & Sessions*.

## Tests
- Run from repo root: `node --loader ./tests/loader.mjs --test tests/*.test.mjs` (122 tests: 112 against stubbed Desktop objects, 10 against the real Hermes gateway).

## Catalog pin
- Authoritative pin lives upstream in `NousResearch/hermes-agent/plugin-catalog/ha-sidebar-navigator.yaml`. `plugin-catalog/ha-sidebar-navigator.yaml` here is a local reference copy and may lag the upstream pin.
