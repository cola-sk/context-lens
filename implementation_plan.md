# Implementation Plan - URL-Based Auto-Switching Rules for AI Providers & Workspaces

This plan outlines the architecture, UI design, and logic for introducing **URL-based Auto-Switching Rules** in ContextLens. 

This feature will allow users to define multiple rules mapping URL patterns (e.g. `*github.com/my-org/*`, `localhost:3000/*`) to specific AI providers, models, and local working directories (CWDs) for the Claude Code local agent. The extension will monitor tab changes and dynamically auto-switch configurations, rendering a beautiful "Matched Rule" banner when a rule is active.

---

## User Review Required

> [!IMPORTANT]
> - **Settings Drawer Tabs:**
>   - We will introduce a clean Tab navigation (`基本配置` / `自动切换规则`) in the settings drawer.
>   - **Tab 1:** Contains the existing provider default API configurations.
>   - **Tab 2:** Features a dynamic Rules Manager where users can view, reorder (move up/down), toggle, delete, and add custom URL switching rules.
> - **Tab URL Matching Rules:**
>   - Rules are evaluated in order of precedence (top to bottom).
>   - Supports glob wildcards (e.g. `*localhost:3000*`, `*github.com/*`) and clean substring matching.
> - **Matched Indicator:**
>   - We will add a gorgeous `#rule-match-banner` immediately above the chat input box to notify the user whenever their current page matches an active workspace rule.

---

## Proposed Changes

### Component 1: Extension HTML UI [MODIFY]

#### [MODIFY] [sidepanel.html](file:///Users/liuzhe.x/coding/ContextLens/sidepanel/sidepanel.html)
1. **Insert `#rule-match-banner`**:
   Add a beautiful matched rule indicator above the footer input bar.
2. **Settings Drawer Restructuring**:
   - Add `.drawer-tabs` navigation buttons right under `.drawer-header`.
   - Wrap `#settings-form` inside `<div id="panel-general">`.
   - Add `<div id="panel-rules" class="hidden">` containing:
     - The rules list container `#rules-list`.
     - An "Add Rule" button `#add-rule-btn`.
     - The rules editor form panel `#rule-editor` (hidden by default, slides down when adding/editing).

---

### Component 2: CSS Styles & Themes [MODIFY]

#### [MODIFY] [sidepanel.css](file:///Users/liuzhe.x/coding/ContextLens/sidepanel/sidepanel.css)
- Style `.drawer-tabs` and `.drawer-tab` (active indicator with `--accent-indigo` border bottom).
- Style `.rule-card`, metadata tags, active switches, and sorting/management buttons.
- Style the rules editor form (`.rule-editor-panel`) with modern inputs and secondary button actions.
- Style the `#rule-match-banner` with micro-animations and glow-indigo accent.

---

### Component 3: Extension JS Logic [MODIFY]

#### [MODIFY] [sidepanel.js](file:///Users/liuzhe.x/coding/ContextLens/sidepanel/sidepanel.js)
1. **Storage and Load Persistence**:
   - Maintain `urlSwitchRules` in local storage. Populate with sensible starter rules on first load.
   - Back up standard settings in `globalSettingsBackup` during initial load.
2. **Glob URL Matcher**:
   - Implement `matchUrlPattern(url, pattern)` supporting standard globbing wildcards (`*`) and case-insensitive substring fallbacks.
3. **Auto-Switch Evaluator**:
   - Implement `applyUrlSwitchingForTab(tabId)` which evaluates the tab URL against active rules.
   - If a rule matches, dynamically override active provider settings and CWD, and render the matching banner.
   - If no rule matches, safely revert to default `globalSettingsBackup` configs.
4. **Rules CRUD & Reordering**:
   - Implement drawer tab toggling.
   - Render the rules list dynamically.
   - Implement rule creation, editing, status toggles, deletion, and order sorting (Move Up/Down).

---

## Verification Plan

### Manual Verification
1. Open the ContextLens settings drawer, navigate to the **自动切换规则** tab.
2. Verify there is a helpful "no rules configured" visual placeholder if empty.
3. Click **添加新规则** (Add Rule) and fill in:
   - **名称:** `ContextLens Workspace`
   - **URL 匹配规则:** `*github.com/cola-sk/context-lens*`
   - **AI 供应商:** `Claude Code 本地 Agent`
   - **工作区绝对路径 (CWD):** `/Users/liuzhe.x/coding/ContextLens`
4. Click **保存规则** and verify the card renders beautifully. Toggle the switch off/on, move it up/down, and try editing.
5. Visit a tab on Github matching the pattern.
   - Verify the chat footer immediately shows `🎯 已按 URL 匹配规则: ContextLens Workspace`.
   - Verify the provider automatically switches to Claude Code and displays `/Users/liuzhe.x/coding/ContextLens`.
6. Switch to a tab on `google.com` (doesn't match).
   - Verify the matched banner slides out of view.
   - Verify the provider and CWD revert to your original default configurations.
7. Perform a query on the matched tab and confirm the local agent spawns and runs in the rule's specific CWD.
