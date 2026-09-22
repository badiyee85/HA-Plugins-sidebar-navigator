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
1. **Packaging Structure Contract (Teknium / Hermes Plugin Validator):**
   - Every desktop plugin directory MUST contain `plugin.yaml` declaring `name`, `version`, `description`, `author`, and capability placeholders.
   - The desktop bundle MUST sit at `desktop/plugin.js` relative to `plugin.yaml` (the loader's `_LOADABLE_ENTRYPOINTS` rejects bare root `plugin.js` as "nothing to load").
   - When housed in a subdirectory, the catalog entry MUST set `subdir: desktop-plugin` (or matching directory).
2. **Two-Phase SHA Pinning (Breaks the Recursive Self-Pin Loop):**
   - **Phase 1 (Plugin Repo):** Complete code, tests, docs, `plugin.yaml`, and `desktop/plugin.js`. Commit and push to `origin/main`. Record the immutable commit SHA via `git rev-parse HEAD`.
   - **Phase 2 (Upstream Catalog PR):** In the upstream PR branch on `NousResearch/hermes-agent`, update `plugin-catalog/<id>.yaml` with that exact SHA and `subdir: desktop-plugin`. Validate with `python3 scripts/validate_plugin_catalog.py`, commit, and push.
3. **Pre-Submission Verification:**
   - Always run `/home/badi/.hermes/hermes-agent/venv/bin/hermes plugins validate <path-to-plugin-dir>` before submitting.
4. **Zero Self-Updating Code:** The plugin loads as static uncompiled ESM. It never attempts self-updates or remote script fetching.
5. **Exact Commit SHA Pinning:** Catalog releases strictly pin a 40-character lowercase commit SHA (`^[0-9a-f]{40}$`).
6. **Public Repository with Tagged Releases:** Releases correspond to git tags on the public repository.
7. **Theme Alignment:** Exclusively consumes Hermes theme CSS variables (`var(--ui-text-*)`, `var(--ui-bg-*)`, `var(--ui-stroke-*)`, `var(--chrome-action-hover)`). Never hardcodes color literals.

## Architecture & Boundaries
- **Runtime:** Loaded dynamically by Hermes Desktop from `$HERMES_HOME/desktop-plugins/ha-sidebar-navigator/plugin.js`.
- **Imports:** Restricted strictly to `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime`.
- **Data Layer:** Uses the unified React Query client via `useQuery` to avoid redundant background poll loops.
