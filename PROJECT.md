# PROJECT.md — Hermes Sidebar Navigator

## Overview
- **Name:** HA-Plugins-sidebar-navigator
- **Plugin ID:** `ha-sidebar-navigator`
- **Maintainer:** Bobby (for Badi)
- **Primary Lane:** `badiyee85`
- **Target Surface:** Hermes Desktop App (`desktop-plugins/ha-sidebar-navigator/plugin.js`)

## Features (v0.7.1)
- Complete project session lists without the 3-item truncation (up to 2,000 sessions per project).
- Search across all projects and sessions (title, preview, ID).
- Projects view and chronological Timeline view.
- Profile/connection browsing via the *Browse profile* selector, with legacy single-profile fallback and surfaced backend error reasons.
- Direct navigation to any session; expandable / collapsible project blocks.
- Live session status dots and profile identity badges (v0.4–0.5).
- Session tagging with colour-coded pills and a tag filter bar (v0.6).
- Context menus on sessions, projects, and the Navigator root; Where chooser for starting a session in Home or a chosen project (v0.7).
- Session actions: rename, pin, unread, colour, copy ID, branch, export, move to project, archive, delete, open in new window.

## Registration surfaces
- Left-rail pane (`navigator-pane`), full page route `/navigator`, sidebar nav item, and command-palette action *Sidebar Navigator: Open All Projects & Sessions*.

## Tests
- Run from repo root: `node --loader ./tests/loader.mjs --test tests/*.test.mjs` (60 tests, SDK stubbed).

## Catalog pin
- Authoritative pin lives upstream in `NousResearch/hermes-agent/plugin-catalog/ha-sidebar-navigator.yaml`. `plugin-catalog/ha-sidebar-navigator.yaml` here is a local reference copy and may lag the upstream pin.
