# PROJECT.md — Hermes Sidebar Navigator

## Overview
- **Name:** HA-Plugins-sidebar-navigator
- **Plugin ID:** `ha-sidebar-navigator`
- **Maintainer:** Bobby (for Badi)
- **Primary Lane:** `badiyee85`
- **Target Surface:** Hermes Desktop App (`desktop-plugins/ha-sidebar-navigator/plugin.js`)

## Features (v0.9.1)
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

## Performance notes (v0.9.1): remote Desktop
- On a Desktop connected to a remote Hermes (VDS, home server), the slow part was not the backend or the rows: `host.profileRoutes()` refetches `/api/profiles` and makes Electron enumerate every saved connection (slowest one wins), and `requestForRoute` re-ran it before any read once its route cache was older than 5 s. The Timeline is usually opened later than that, so it paid the whole lookup before `session.list`, as did every 15 s refetch.
- Reads use the cached route catalog at once and never wait for a roster lookup. The catalog is re-checked in the background at most every `ROUTE_CACHE_TTL_MS` (5 s), one lookup at a time, which keeps the old freshness without the wait. If the re-check finds the route removed or replaced (same connection, different backend profile), the route's Navigator queries are invalidated and the next read fails with "no longer available" instead of showing another backend's sessions. `ROUTE_CATALOG_TTL_MS` (5 min) is only a hard ceiling after which a read blocks on a fresh lookup.
- Navigator open, the Refresh button and every action (`mutateForRoute`, `withStoredSession`, bulk, open) still resolve the route fresh before acting.
- A failed read is never re-sent (a write cannot run twice). It waits for the lookup already in flight, or uses the catalog (at most 5 s old), and reports "no longer available" only if the route is really gone; otherwise its own error stands. Concurrent failures and React Query retries share one lookup, so an outage does not set off a lookup storm.
- The Navigator prefetches the Timeline's session list (`prefetchTimeline`, same definition as the Timeline via `sessionListQuery`) when a profile is selected, so switching to Timeline shows rows at once. The prefetch is one fetch and adds no poll.
- Measured backend cost on a real store: `session.list` 8-43 ms, `projects.tree` 17-112 ms, `profiles.list` 18-546 ms. The plugin-side harness (fake host, 400 ms roster stand-in) went from 461 ms to 60 ms for a Timeline click, with the roster lookup moved off the critical path. Not yet timed in the live app.

## Registration surfaces
- Left-rail pane (`navigator-pane`), full page route `/navigator`, sidebar nav item, and command-palette action *Sidebar Navigator: Open All Projects & Sessions*.

## Tests
- Run from repo root: `node --loader ./tests/loader.mjs --test tests/*.test.mjs` (131 tests: 121 against stubbed Desktop objects, 10 against the real Hermes gateway).

## Catalog pin
- Authoritative pin lives upstream in `NousResearch/hermes-agent/plugin-catalog/ha-sidebar-navigator.yaml`. `plugin-catalog/ha-sidebar-navigator.yaml` here is a local reference copy and may lag the upstream pin.
