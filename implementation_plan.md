# Implementation Plan - Refactoring Model Selection to List & Custom Models Management

This plan outlines the architecture, UI changes, and JS logic to transition the model selection field in basic settings into an interactive, manageable list with support for adding custom models (such as `codex-agent`, `deepseek-chat`, etc.) and deleting them. It also covers removing the redundant matched rule URL switching banner since the bottom status bar already displays the active model/agent.

---

## User Review Required

> [!IMPORTANT]
> - **Removal of Redundant Matched URL Banner:**
>   - The `#rule-match-banner` element displayed above the chat input will be removed to prevent clutter and redundancy, as the status bar pill at the bottom already highlights the active model/agent accurately.
> - **Interactive Model List & Custom Additions:**
>   - Instead of a dropdown selection, basic settings will show a beautifully designed scrollable list of models for the active provider.
>   - A `➕ 添加模型` button on the top-right of the model section will enable users to add custom models or local agent identifiers to any provider.
>   - User-added custom models will display a small trash button to delete them dynamically.
>   - The added models will be saved in `chrome.storage.local` under `addedProviderModels` and will be dynamically available in the auto-switching rules selector.

---

## Proposed Changes

### Component 1: Extension HTML [MODIFY]

#### [MODIFY] [sidepanel.html](file:///Users/liuzhe.x/coding/ContextLens/sidepanel/sidepanel.html)
- Remove the redundant `#rule-match-banner` from `app-footer`.
- Replace the `<select id="api-model">` in `#model-select-group` with a structured list layout:
  - Header: Label plus sync button and `➕ 添加` button.
  - Container: `#model-list-container` to render model items dynamically.

---

### Component 2: CSS Styles [MODIFY]

#### [MODIFY] [sidepanel.css](file:///Users/liuzhe.x/coding/ContextLens/sidepanel/sidepanel.css)
- Add rules for:
  - `.model-select-header` (flex alignment of label and buttons)
  - `.add-model-btn`, `.sync-btn` (sleek micro-buttons)
  - `.model-list-container` (scrollable box with subtle borders and shadows)
  - `.model-item` (interactive pills, transitions, `.active` styling)
  - `.model-item-info`, `.model-item-name`, `.model-item-id`
  - `.model-item-delete` (coral hover state for deleting custom models)

---

### Component 3: Extension JS Logic [MODIFY]

#### [MODIFY] [sidepanel.js](file:///Users/liuzhe.x/coding/ContextLens/sidepanel/sidepanel.js)
1. **Model Storage & Migration (`addedProviderModels`)**:
   - Initialize a global object: `addedProviderModels = { gemini: [], openai: [], claude: [], "claude-agent": [], custom: [] };`.
   - Retrieve `addedProviderModels` in `loadSettings()`.
   - Implement seamless backward compatibility: if existing `customModels` exist in local storage, migrate them to `addedProviderModels.custom`.
2. **Refactored `renderModelSelection(provider, selectedValue)`**:
   - Instead of a dropdown or input, dynamically build a list of pre-configured + custom added models.
   - Inject a hidden `<input type="hidden" id="api-model">` with the selected model value to ensure the existing submit/save logic handles selected models perfectly without modifications.
   - Handle active states, selection clicks, and custom model deletion.
3. **Refactored `handleFetchCustomModels()`**:
   - Adapt it to save fetched custom models directly into both `customModels` (for compatibility) and `addedProviderModels.custom`.
4. **Interactive Prompt for Adding Custom Models**:
   - Wire up `add-model-btn` to prompt the user for model ID (e.g. `codex-agent`) and showing-name, and select it instantly.
5. **Auto-Switching Rule Editor**:
   - Update `renderRuleModelSelection` to load both pre-configured and custom added models for the selected provider.
6. **Clean Up Rule Match Banner**:
   - Safely remove/ignore the banner updates to prevent any element-not-found issues.

---

## Verification Plan

### Manual Verification
1. **Verify Banner Removal:**
   - Navigate matching tabs, verify no "已按 URL 匹配规则..." banner shows up, but the active model/agent dynamically updates in the bottom status pill.
2. **Verify Interactive Model List:**
   - In "基本配置" drawer, observe the models rendered as a list instead of a dropdown.
   - Verify selecting a model updates the active selection immediately and is saved properly.
3. **Verify Adding Custom Model/Agent:**
   - Click `➕ 添加模型` in the top right.
   - Enter model identifier `codex-agent`, and display name `Codex Local Agent`.
   - Confirm it appears in the list, is selected, and is highlighted.
   - Click "保存配置" and check the status bar updates to "Codex Local Agent" / `codex-agent`.
4. **Verify Deleting Custom Model:**
   - Click the small trash icon next to `Codex Local Agent`.
   - Confirm it is deleted, and selection falls back to the default provider model.
5. **Verify Rules Selector Integrations:**
   - Go to Tab 2 (自动切换规则) -> Click edit/create rule -> Choose provider `Claude Code 本地 Agent` or custom.
   - Verify the custom added model appears in the rule editor's model dropdown list.
