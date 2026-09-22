> English translation of [CONTEXT.md](CONTEXT.md). The Chinese file is the normative source; keep both in sync.

# ZCode Plugin Store

Domain vocabulary for the plugin settings page and its marketplace browsing/installation experience. This file is the single definition of store-related terms for pages, services, and documentation.

## Language

### Marketplaces and sources

**Official Marketplace**:
The only distribution channel operated by ZCode itself. Marketplace id `zcode-plugins-official`; contents = builtin plugins + CDN plugins. It is a "distribution channel", not an "authorship" label: plugins from community authors can be listed there.
_Avoid_: using "official" loosely for every trusted marketplace

**Builtin Plugin**:
A plugin shipped with the application bundle and seeded into the Official Marketplace at startup. A subset of official plugins.
_Avoid_: pre-installed plugin, bundled plugin (fine in speech; documentation uses "builtin")

**CDN Plugin**:
A plugin in the Official Marketplace that is distributed through the official CDN as a sha256-verified zip and downloaded and installed on demand.
_Avoid_: network plugin, online plugin

**Personal Source**:
Any plugin source the user adds themselves: git/GitHub/URL/local-directory marketplaces and inline plugins.
_Avoid_: none

**Catalog Auto-Refresh**:
A throttled background refresh of the Official Marketplace catalog when entering the store page; invisible to the user; covers only the official marketplace.
_Avoid_: confusing it with Manual Refresh; calling it "check for updates" (the update badge is only a by-product of the refresh)

**Manual Refresh**:
A refresh of every marketplace triggered by the refresh button in the store page's top bar; not subject to the auto-refresh throttle.
_Avoid_: refresh, check for updates (fine in speech; documentation uses "manual refresh")

### Store page structure

**Public Segment**:
One of the two segments of the store list page. Shows the Official Marketplace catalog and nothing else (Featured + category blocks).
_Avoid_: official tab, store tab

**Personal Segment**:
The other segment of the store list page. Shows the catalogs of all Personal Sources, grouped by marketplace.
_Avoid_: third-party tab, my tab

**Featured**:
The curated area at the top of the Public Segment. The list is remotely controlled by the `featured` field of the official CDN catalog. Exists only in the Public Segment.
_Avoid_: confusing it with Recommended

**Installed Strip**:
A row of installed-plugin icons at the top of the list page; clicking an icon opens the detail page.
_Avoid_: installed list (that is the Manage Installed view)

**Manage Installed View**:
The management screen opened from the gear to the right of the Installed Strip. Holds per-plugin enable/disable switches, updates, uninstall, and filtering by enabled state.
_Avoid_: Installed tab (old IA term, deprecated)

### Metadata

**Store Listing**:
Presentational metadata carried by a catalog entry: display name, icon, category, developer, website/privacy-policy/terms links, hero image, example prompts. Describes "how it is presented in the store" and does not affect plugin functionality.
_Avoid_: plugin metadata (ambiguous; may mean the manifest)

**Plugin Manifest**:
The functional definition in `plugin.json` inside the plugin package (commands/agents/skills/hooks/mcpServers/userConfig…). Describes "what the plugin is and does".
_Avoid_: marketplace.json (that is the catalog, not the manifest)

**Example Prompt**:
A clickable prompt provided by the Store Listing. Clicking creates a new session with the prompt pre-filled (not auto-sent). It is the only "new session" entry point on the detail page.
_Avoid_: quick command, prompt template, try now

### Lifecycle states

**Plugin Lifecycle**:
The full product path from discovering a plugin through viewing, installing, configuring, enabling/disabling, using, checking for updates, upgrading, and persisted recovery, to uninstalling or restoring a builtin plugin. Every stage must be verified against both the visible UI state and the corresponding persisted or runtime result.
_Avoid_: treating "installed successfully" alone as the full lifecycle

**Restorable Builtin**:
A Builtin Plugin the user has uninstalled and that has entered a persisted suppressed state. An application restart must not automatically re-seed it; it keeps appearing in the Public Segment and is cleanly restored through the "Install" entry point.
_Avoid_: uninstalled CDN plugin, temporarily disabled builtin plugin

**Orphaned Installed Plugin**:
A plugin whose Personal Source has been removed while its installation directory and user data remain. It can still be used, configured, enabled/disabled, and uninstalled; it cannot be updated until its source is re-added, after which the catalog association is restored.
_Avoid_: broken install, missing manifest, uninstalled plugin
