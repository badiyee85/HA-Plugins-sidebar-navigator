# AGENTS.md — Hermes Sidebar Navigator

Local operating contract for `HA-Plugins-sidebar-navigator`.

## Purpose & Mission
`HA-Plugins-sidebar-navigator` is a dedicated desktop navigation and exploration plugin for Hermes Agent Desktop. It addresses the default 3-session preview cap in the desktop sidebar overview, providing:
1. **Full Project Session Access:** Uncapped, inner-scrolling sessions per project via `projects.tree` and `projects.project_sessions`.
2. **Instant Search & Filter:** Real-time fuzzy/text search across session titles and preview snippets.
3. **Multi-View Modes:** Toggle seamlessly between Projects View (grouped by repository/project) and Chronological Sessions View (all sessions ordered newest-first).
4. **Seamless Navigation:** Deep-links directly to `#/<sessionId>` via the official `host.navigate` interface.

## GitHub Lane & Identity
- **Repository:** `badiyee85/HA-Plugins-sidebar-navigator`
- **Identity:** Always commit and push using the `badiyee85` GitHub identity. Never push using `cspiritsong`.

## Hermes Plugin Catalog & Packaging Standards
This project complies strictly with the curated Hermes Plugin Catalog standards (`NousResearch/hermes-agent/plugin-catalog`):
1. **Zero Self-Updating Code:** The plugin loads as static uncompiled ESM. It never attempts self-updates or remote script fetching.
2. **Exact Commit SHA Pinning:** Catalog releases strictly pin a 40-character lowercase commit SHA (`^[0-9a-f]{40}$`).
3. **Public Repository with Tagged Releases:** Releases correspond to git tags on the public repository.
4. **Theme Alignment:** Exclusively consumes Hermes theme CSS variables (`var(--ui-text-*)`, `var(--ui-bg-*)`, `var(--ui-stroke-*)`, `var(--chrome-action-hover)`). Never hardcodes color literals.

## Architecture & Boundaries
- **Runtime:** Loaded dynamically by Hermes Desktop from `$HERMES_HOME/desktop-plugins/ha-sidebar-navigator/plugin.js`.
- **Imports:** Restricted strictly to `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime`.
- **Data Layer:** Uses the unified React Query client via `useQuery` to avoid redundant background poll loops.
