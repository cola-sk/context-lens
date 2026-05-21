// Logic for ContextLens Side Panel

// Global App State
let appSettings = {
  apiProvider: "gemini",
  apiKey: "",
  apiUrl: "",
  modelName: "gemini-2.5-flash",
  temperature: 0.7,
  cwd: "",
  claudePath: "",
  providers: {
    gemini: { apiKey: "", modelName: "gemini-2.5-flash" },
    openai: { apiKey: "", modelName: "gpt-4o-mini" },
    claude: { apiKey: "", modelName: "claude-3-5-sonnet-latest" },
    custom: { apiKey: "", apiUrl: "", modelName: "" },
    "claude-agent": { apiUrl: "http://localhost:3100", cwd: "", claudePath: "", modelName: "claude-code" },
    "codex-agent": { apiUrl: "http://localhost:3100", cwd: "", claudePath: "", modelName: "codex" },
    "gemini-agent": { apiUrl: "http://localhost:3100", cwd: "", claudePath: "", modelName: "gemini" }
  }
};

// Active Model ID (references an item in configuredApiModels or a detected local agent id)
let activeModelId = null;

// User-configured API models (saved to chrome.storage.local under "configuredApiModels")
// Each entry: { id, provider, label, model, apiKey, apiUrl, bridgeUrl }
let configuredApiModels = [];

// Detected local agents from bridge (populated on load via /api/agents)
let detectedLocalAgents = [];

// Bridge URL used for local agents
const DEFAULT_BRIDGE_URL = "http://localhost:3100";

let activeFormProvider = "gemini";

let urlSwitchRules = [];
let defaultSettingsBackup = null;

let currentContext = null; // { text, pageUrl, pageTitle }
let chatHistory = []; // Unified messages history [{ role: 'user'|'assistant', content }]
let includeFullPageChecked = false; // cached checkbox state for active tab
let activeReader = null; // Current stream reader to abort if needed
let customModels = []; // Legacy cache (kept for backward compat with rules)
let addedProviderModels = {
  gemini: [],
  openai: [],
  claude: [],
  "claude-agent": [],
  "codex-agent": [],
  "gemini-agent": [],
  custom: []
};

// Tab Isolation Cache
let tabStates = {}; // tabId -> { currentContext, chatHistory, includeFullPageChecked }
let currentTabId = null;
let tabTemporaryModelOverrides = {}; // tabId -> { modelId, updatedAt }

// Get or initialize state for a tab
function getTabState(tabId) {
  if (!tabId) return { currentContext: null, chatHistory: [], includeFullPageChecked: false };
  if (!tabStates[tabId]) {
    tabStates[tabId] = {
      currentContext: null,
      chatHistory: [],
      includeFullPageChecked: false
    };
  }
  return tabStates[tabId];
}

// Persist tabStates to chrome.storage.local
function persistTabStates() {
  chrome.storage.local.set({ tabStates }).catch(err => console.warn("Failed to persist tab states:", err));
}

// Save active tab's global state to tabStates before switching or modifying
function saveActiveTabState() {
  if (currentTabId) {
    const state = getTabState(currentTabId);
    state.currentContext = currentContext;
    state.chatHistory = [...chatHistory];
    state.includeFullPageChecked = includeFullPageChecked;
    persistTabStates();
  }
}

// Restore active tab's state from tabStates
function restoreActiveTabState(tabId) {
  if (!tabId) return;
  currentTabId = tabId;
  const state = getTabState(tabId);
  currentContext = state.currentContext;
  chatHistory = [...state.chatHistory];
  includeFullPageChecked = state.includeFullPageChecked;
}

// System prompt to feed the AI
const SYSTEM_PROMPT = `You are ContextLens, a precise and helpful AI coding and research assistant.
You are helping the user understand a snippet of text they selected on a website.
Provide explanations, code debugging, or answers in direct response to their selected text and any follow-up questions they have.
Be concise, accurate, and focus directly on the context provided. Use markdown formatting for code blocks, lists, and bold text.`;

function getContextImages(contextData, maxImages = 5) {
  if (!contextData || !Array.isArray(contextData.images)) return [];
  return contextData.images
    .filter(img => img && typeof img.src === "string" && img.src.trim().length > 0)
    .filter(img => !img.src.startsWith("data:"))
    .slice(0, maxImages);
}

function buildImageContextBlock(images) {
  if (!images || images.length === 0) return "";

  let block = "\n[Images in Selection]\n";
  images.forEach((img, idx) => {
    const pieces = [`${idx + 1}. URL: ${img.src}`];
    if (img.alt) pieces.push(`Alt: "${img.alt}"`);
    if (img.title) pieces.push(`Title: "${img.title}"`);
    if (img.width && img.height) pieces.push(`Size: ${img.width}x${img.height}`);
    block += `${pieces.join(" | ")}\n`;
  });
  return block;
}

function supportsStructuredImageInput(provider, modelName) {
  if (provider !== "openai") return false;
  const model = (modelName || "").toLowerCase();
  if (!model) return false;

  return /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|vision|omni/.test(model);
}

// DOM Elements
const welcomeScreen = document.getElementById("welcome-screen");
const configureNowBtn = document.getElementById("configure-now-btn");
const contextBanner = document.getElementById("context-banner");
const contextText = document.getElementById("context-text");
const contextSourcePage = document.getElementById("context-source-page");
const clearContextBtn = document.getElementById("clear-context-btn");
const messagesList = document.getElementById("messages-list");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const connectionStatusPill = document.getElementById("connection-status-pill");
const connectedModelName = document.getElementById("connected-model-name");
const modelQuickPopover = document.getElementById("model-quick-popover");
const modelQuickCloseBtn = document.getElementById("model-quick-close");
const modelQuickCurrentDomain = document.getElementById("model-quick-current-domain");
const modelQuickList = document.getElementById("model-quick-list");

// Settings Drawer DOM
const settingsToggle = document.getElementById("settings-toggle");
const settingsDrawer = document.getElementById("settings-drawer");
const settingsClose = document.getElementById("settings-close");
const modelTemperature = document.getElementById("model-temperature");
const tempVal = document.getElementById("temp-val");
const settingsStatus = document.getElementById("settings-status");
const modelCardList = document.getElementById("model-card-list");
const modelCardsStatus = document.getElementById("model-cards-status");

// Legacy DOM elements referenced in some non-settings areas (still used by URL rules / chat logic)
const apiProvider = null; // removed from UI, kept as null
const apiKey = { value: "" }; // stub
const apiUrl = { value: "" }; // stub
const cwdGroup = document.getElementById("cwd-group");
const apiCwd = document.getElementById("api-cwd");
const claudePathGroup = null; // removed from UI
const claudePath = { value: "" }; // stub
const keyGroup = null;
const apiKeyLabel = null;
const toggleKeyVisibility = null;
const urlGroup = null;
const modelSelectGroup = null;
const modelLabel = null;
const modelListContainer = null;

// Provider Models Catalog
const providerModels = {
  gemini: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (默认)" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (高质量)" }
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o Mini (极速)" },
    { value: "gpt-4o", label: "GPT-4o (高性能)" },
    { value: "o1-mini", label: "o1 Mini (深度推理)" }
  ],
  claude: [
    { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet (默认)" },
    { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (极速)" }
  ],
  "claude-agent": [
    { value: "claude-code", label: "Claude Code CLI Agent" }
  ],
  "codex-agent": [
    { value: "codex", label: "Codex CLI Agent" }
  ],
  "gemini-agent": [
    { value: "gemini", label: "Gemini CLI Agent" }
  ]
};

// --- INITIALIZATION ---

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  setupEventListeners();
  updateStatusUI();
  
  // Listen for text selection changes via session storage
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.lastSelection?.newValue) {
      handleNewSelection(changes.lastSelection.newValue, true);
    }
  });

  // Track active tab and handle tab switching in the current window
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      const currentWindow = await chrome.windows.getCurrent();
      if (tab.windowId === currentWindow.id) {
        saveActiveTabState();
        restoreActiveTabState(activeInfo.tabId);
        await applyUrlSwitchingForTab(tab);
        rebuildUIForActiveTab();
      }
    } catch (e) {
      console.warn("Failed to check tab window affiliation on activation:", e);
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
      const currentWindow = await chrome.windows.getCurrent();
      if (tab.active && tab.windowId === currentWindow.id && changeInfo.status === "complete") {
        saveActiveTabState();
        restoreActiveTabState(tabId);
        await applyUrlSwitchingForTab(tab);
        rebuildUIForActiveTab();
      }
    } catch (e) {
      console.warn("Failed to handle tab update in sidepanel:", e);
    }
  });

  // Check if there is already a selection on load
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    currentTabId = tabs[0].id;
  }
  restoreActiveTabState(currentTabId);

  const sessionData = await chrome.storage.session.get("lastSelection");
  if (sessionData.lastSelection) {
    // If the selection was set very recently (< 5 seconds), the background script just
    // fired a new user-triggered action (right-click / floating button). In that case
    // treat it as a new interaction so the chat history is cleared and the panel shows
    // fresh context.  This fixes a race condition where the storage.session.onChanged
    // listener was not yet registered when the background wrote the value, so the
    // onChanged event never fired and the rehydration path was the only one executed —
    // wrongly preserving old history (isNewInteraction=false).
    const selectionAgeMs = Date.now() - (sessionData.lastSelection.timestamp || 0);
    const isFreshUserAction = selectionAgeMs < 5000;
    handleNewSelection(sessionData.lastSelection, isFreshUserAction);
  } else {
    rebuildUIForActiveTab();
  }
});

// Load settings from chrome.storage.local
async function loadSettings() {
  const result = await chrome.storage.local.get(["apiProvider", "apiKey", "apiUrl", "modelName", "temperature", "customModels", "cwd", "claudePath", "providers", "urlSwitchRules", "addedProviderModels", "configuredApiModels", "activeModelId", "tabStates"]);
  
  tabStates = result.tabStates || {};
  appSettings.apiProvider = result.apiProvider || "gemini";
  appSettings.temperature = result.temperature !== undefined ? parseFloat(result.temperature) : 0.7;

  // Set up providers config cache with robust fallback defaults
  const defaultProviders = {
    gemini: { apiKey: "", modelName: "gemini-2.5-flash" },
    openai: { apiKey: "", modelName: "gpt-4o-mini" },
    claude: { apiKey: "", modelName: "claude-3-5-sonnet-latest" },
    custom: { apiKey: "", apiUrl: "", modelName: "" },
    "claude-agent": { apiUrl: "http://localhost:3100", cwd: "", claudePath: "", modelName: "claude-code" },
    "codex-agent": { apiUrl: "http://localhost:3100", cwd: "", claudePath: "", modelName: "codex" },
    "gemini-agent": { apiUrl: "http://localhost:3100", cwd: "", claudePath: "", modelName: "gemini" }
  };
  
  appSettings.providers = {};
  for (const [provId, defConfig] of Object.entries(defaultProviders)) {
    const savedConfig = (result.providers && result.providers[provId]) ? result.providers[provId] : {};
    appSettings.providers[provId] = { ...defConfig, ...savedConfig };
  }

  // Backward compatibility migration:
  // If root variables exist in result, copy them to the corresponding provider inside providers cache
  if (result.apiKey || result.apiUrl || result.modelName || result.cwd || result.claudePath) {
    const prov = result.apiProvider || "gemini";
    if (appSettings.providers[prov]) {
      if (result.apiKey && !appSettings.providers[prov].apiKey) appSettings.providers[prov].apiKey = result.apiKey;
      if (result.apiUrl && !appSettings.providers[prov].apiUrl) appSettings.providers[prov].apiUrl = result.apiUrl;
      if (result.modelName && !appSettings.providers[prov].modelName) appSettings.providers[prov].modelName = result.modelName;
      if (result.cwd && !appSettings.providers[prov].cwd) appSettings.providers[prov].cwd = result.cwd;
      if (result.claudePath && !appSettings.providers[prov].claudePath) appSettings.providers[prov].claudePath = result.claudePath;
    }
  }

  // Load custom models (legacy) and addedProviderModels
  customModels = result.customModels || [];

  addedProviderModels = result.addedProviderModels || {
    gemini: [],
    openai: [],
    claude: [],
    "claude-agent": [],
    "codex-agent": [],
    "gemini-agent": [],
    custom: []
  };

  const provKeys = ["gemini", "openai", "claude", "claude-agent", "codex-agent", "gemini-agent", "custom"];
  provKeys.forEach(k => {
    if (!addedProviderModels[k]) addedProviderModels[k] = [];
  });

  if (customModels.length > 0 && addedProviderModels.custom.length === 0) {
    addedProviderModels.custom = customModels.map(m => ({ value: m, label: m }));
  }

  // Load configuredApiModels (new per-model config system)
  configuredApiModels = result.configuredApiModels || [];

  // Migrate legacy providers config into configuredApiModels (one-time migration)
  if (configuredApiModels.length === 0) {
    const legacyMigrations = [
      { provider: "gemini", provId: "gemini", labelBase: "Gemini", defaultModel: "gemini-2.5-flash" },
      { provider: "openai", provId: "openai", labelBase: "OpenAI GPT", defaultModel: "gpt-4o-mini" },
      { provider: "claude", provId: "claude", labelBase: "Claude API", defaultModel: "claude-3-5-sonnet-latest" },
      { provider: "custom", provId: "custom", labelBase: "Custom API", defaultModel: "" }
    ];
    for (const { provider, provId, labelBase, defaultModel } of legacyMigrations) {
      const savedProv = appSettings.providers[provId] || {};
      if (savedProv.apiKey && savedProv.apiKey.trim()) {
        configuredApiModels.push({
          id: `${provId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          provider,
          label: labelBase,
          model: savedProv.modelName || defaultModel,
          apiKey: savedProv.apiKey,
          apiUrl: savedProv.apiUrl || ""
        });
      }
    }
    if (configuredApiModels.length > 0) {
      await chrome.storage.local.set({ configuredApiModels });
    }
  }

  // Load activeModelId
  activeModelId = result.activeModelId || null;

  // Load urlSwitchRules
  urlSwitchRules = result.urlSwitchRules || [];
  if (urlSwitchRules.length === 0) {
    urlSwitchRules = [
      {
        name: "ContextLens Workspace",
        pattern: "*github.com/cola-sk/context-lens*",
        provider: "claude-agent",
        model: "claude-code",
        cwd: "/Users/liuzhe.x/coding/ContextLens",
        enabled: true
      },
      {
        name: "Github Repositories",
        pattern: "*github.com/*",
        provider: "claude",
        model: "claude-3-5-sonnet-latest",
        cwd: "",
        enabled: true
      }
    ];
    await chrome.storage.local.set({ urlSwitchRules: urlSwitchRules });
  }

  // Update temperature slider
  modelTemperature.value = appSettings.temperature;
  tempVal.textContent = appSettings.temperature;

  // Resolve the active model from saved activeModelId (using existing detectedLocalAgents if any)
  applyActiveModelToAppSettings();

  // Initialize a backup copy of the default configurations
  defaultSettingsBackup = {
    apiProvider: appSettings.apiProvider,
    temperature: appSettings.temperature,
    apiKey: appSettings.apiKey,
    apiUrl: appSettings.apiUrl,
    modelName: appSettings.modelName,
    cwd: "",
    claudePath: appSettings.claudePath,
    providers: JSON.parse(JSON.stringify(appSettings.providers))
  };

  // Evaluate URL auto-switching rules for the current tab
  await evaluateUrlSwitchingForActiveTab();

  // Detect local agents from bridge ASYNCHRONOUSLY (non-blocking, updates card list when done)
  refreshLocalAgentsAsync();
}

// Fire-and-forget bridge detection - never awaited in the critical path
function refreshLocalAgentsAsync() {
  if (modelCardsStatus) modelCardsStatus.textContent = "正在探测本地 Agent...";
  fetchLocalAgentsFromBridge(DEFAULT_BRIDGE_URL).then(async agents => {
    detectedLocalAgents = agents;
    applyActiveModelToAppSettings();
    
    // Update the base settings backup so rules can fall back to the newly resolved agent
    defaultSettingsBackup = {
      apiProvider: appSettings.apiProvider,
      temperature: appSettings.temperature,
      apiKey: appSettings.apiKey,
      apiUrl: appSettings.apiUrl,
      modelName: appSettings.modelName,
      cwd: "",
      claudePath: appSettings.claudePath,
      providers: JSON.parse(JSON.stringify(appSettings.providers))
    };

    // Re-evaluate rules so that if the user is on a matching tab, the rule overrides the base settings immediately
    await evaluateUrlSwitchingForActiveTab();
    
    updateStatusUI();
  }).catch(() => {
    if (modelCardsStatus) modelCardsStatus.textContent = "Bridge 未连接";
    renderAvailableModelCards();
  });
}

function getAllModelChoices() {
  const choices = [];

  detectedLocalAgents
    .filter(agent => agent && agent.available)
    .forEach((agent) => {
      choices.push({
        id: agent.id,
        type: "local",
        provider: agent.id,
        model: agent.id,
        label: agent.label || agent.id,
        meta: agent.version ? `v${agent.version} · 本地 Agent` : "本地 Agent",
        executablePath: agent.executablePath || ""
      });
    });

  configuredApiModels.forEach((model) => {
    choices.push({
      id: model.id,
      type: "api",
      provider: model.provider,
      model: model.model,
      label: model.label || model.model,
      meta: `${model.provider.toUpperCase()} API`,
      apiKey: model.apiKey || "",
      apiUrl: model.apiUrl || ""
    });
  });

  return choices;
}

function resolveModelChoiceById(modelId) {
  if (!modelId) return null;
  return getAllModelChoices().find(choice => choice.id === modelId) || null;
}

function applyModelChoiceToAppSettings(choice) {
  if (!choice) return false;

  if (choice.type === "api") {
    appSettings.apiProvider = choice.provider;
    appSettings.apiKey = choice.apiKey || "";
    appSettings.apiUrl = choice.apiUrl || "";
    appSettings.modelName = choice.model || "";
    appSettings.cwd = "";
    appSettings.claudePath = "";

    if (appSettings.providers[choice.provider]) {
      appSettings.providers[choice.provider].apiKey = choice.apiKey || "";
      appSettings.providers[choice.provider].apiUrl = choice.apiUrl || "";
      appSettings.providers[choice.provider].modelName = choice.model || "";
    }
  } else {
    const provCfg = defaultSettingsBackup?.providers?.[choice.provider] || appSettings.providers[choice.provider] || {};

    appSettings.apiProvider = choice.provider;
    appSettings.apiKey = "";
    appSettings.apiUrl = DEFAULT_BRIDGE_URL;
    appSettings.modelName = choice.model;
    appSettings.cwd = provCfg.cwd || "";
    appSettings.claudePath = provCfg.claudePath || choice.executablePath || "";

    if (appSettings.providers[choice.provider]) {
      appSettings.providers[choice.provider].modelName = choice.model;
      appSettings.providers[choice.provider].apiUrl = DEFAULT_BRIDGE_URL;
      appSettings.providers[choice.provider].cwd = appSettings.cwd;
      appSettings.providers[choice.provider].claudePath = appSettings.claudePath;
    }
  }

  updateStatusUI();
  return true;
}

function applyTemporaryModelOverrideForTab(tabId) {
  if (!tabId || !tabTemporaryModelOverrides[tabId]) return false;

  const override = tabTemporaryModelOverrides[tabId];
  const choice = resolveModelChoiceById(override.modelId);
  if (!choice) {
    delete tabTemporaryModelOverrides[tabId];
    return false;
  }

  return applyModelChoiceToAppSettings(choice);
}

function getDomainPatternFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return "*";
    return `*${parsed.hostname}/*`;
  } catch (e) {
    return "*";
  }
}

function openRuleEditorWithPreset(preset) {
  toggleDrawer(true);

  const tabGeneral = document.getElementById("tab-general");
  const tabRules = document.getElementById("tab-rules");
  const panelGeneral = document.getElementById("panel-general");
  const panelRules = document.getElementById("panel-rules");
  if (tabGeneral && tabRules && panelGeneral && panelRules) {
    tabRules.classList.add("active");
    tabGeneral.classList.remove("active");
    panelRules.classList.remove("hidden");
    panelGeneral.classList.add("hidden");
  }

  const existingIndex = urlSwitchRules.findIndex(rule => rule.pattern === preset.pattern);
  openRuleEditor(existingIndex >= 0 ? existingIndex : null);

  const ruleName = document.getElementById("rule-name");
  const rulePattern = document.getElementById("rule-pattern");
  const ruleProvider = document.getElementById("rule-provider");
  const ruleCwd = document.getElementById("rule-cwd");

  if (ruleName) ruleName.value = preset.name || "";
  if (rulePattern) rulePattern.value = preset.pattern || "*";
  if (ruleCwd) ruleCwd.value = preset.cwd || "";
}

function closeModelQuickPopover() {
  if (modelQuickPopover) {
    modelQuickPopover.classList.add("hidden");
  }
}

async function openModelQuickPopover() {
  if (!modelQuickPopover || !modelQuickList) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) return;

  const allChoices = getAllModelChoices();
  const currentOverrideModelId = tabTemporaryModelOverrides[tab.id]?.modelId || null;
  const activeSignature = `${appSettings.apiProvider}::${appSettings.modelName}`;
  const domain = (() => {
    try {
      return new URL(tab.url || "").hostname || (tab.url || "当前页面");
    } catch (e) {
      return tab.url || "当前页面";
    }
  })();

  if (modelQuickCurrentDomain) {
    modelQuickCurrentDomain.textContent = domain;
    modelQuickCurrentDomain.title = tab.url || "";
  }

  modelQuickList.innerHTML = "";

  if (currentOverrideModelId) {
    const restoreRow = document.createElement("div");
    restoreRow.className = "model-quick-row";
    restoreRow.innerHTML = `
      <div class="model-quick-row-main">
        <div class="model-quick-row-title">恢复正式规则模型</div>
        <div class="model-quick-row-sub">撤销当前页面临时模型，回到 URL 规则或默认模型</div>
      </div>
      <div class="model-quick-row-actions">
        <button type="button" class="model-quick-btn restore-btn">恢复</button>
      </div>
    `;
    const restoreBtn = restoreRow.querySelector(".restore-btn");
    restoreBtn.addEventListener("click", async () => {
      delete tabTemporaryModelOverrides[tab.id];
      await applyUrlSwitchingForTab(tab);
      closeModelQuickPopover();
    });
    modelQuickList.appendChild(restoreRow);
  }

  if (allChoices.length === 0) {
    modelQuickList.innerHTML += `<div class="model-quick-empty">暂无可切换模型，请先在基本配置中添加模型。</div>`;
    modelQuickPopover.classList.remove("hidden");
    return;
  }

  allChoices.forEach((choice) => {
    const row = document.createElement("div");
    const choiceSignature = `${choice.provider}::${choice.model}`;
    const isCurrent = currentOverrideModelId
      ? currentOverrideModelId === choice.id
      : choiceSignature === activeSignature;

    row.className = `model-quick-row${isCurrent ? " current" : ""}`;
    row.innerHTML = `
      <div class="model-quick-row-main">
        <div class="model-quick-row-title">${escapeHTML(choice.label)}</div>
        <div class="model-quick-row-sub">${escapeHTML(choice.meta || choice.model)}</div>
      </div>
      <div class="model-quick-row-actions">
        <button type="button" class="model-quick-btn switch-btn" data-model-id="${choice.id}" ${isCurrent ? "disabled" : ""}>${isCurrent ? "当前" : "本页临时切换"}</button>
        <button type="button" class="model-quick-btn rule-btn" data-model-id="${choice.id}">建域名规则</button>
      </div>
    `;

    const switchBtn = row.querySelector(".switch-btn");
    const ruleBtn = row.querySelector(".rule-btn");

    switchBtn.addEventListener("click", () => {
      tabTemporaryModelOverrides[tab.id] = { modelId: choice.id, updatedAt: Date.now() };
      applyTemporaryModelOverrideForTab(tab.id);
      closeModelQuickPopover();
    });

    ruleBtn.addEventListener("click", () => {
      const cwdDefault = choice.provider.endsWith("-agent")
        ? (appSettings.providers[choice.provider]?.cwd || appSettings.cwd || "")
        : "";

      openRuleEditorWithPreset({
        name: `${domain} · ${choice.label}`,
        pattern: getDomainPatternFromUrl(tab.url || ""),
        provider: choice.provider,
        model: choice.model,
        cwd: cwdDefault
      });
      closeModelQuickPopover();
    });

    modelQuickList.appendChild(row);
  });

  modelQuickPopover.classList.remove("hidden");
}



// Fetch detected local agents from bridge /api/agents endpoint
async function fetchLocalAgentsFromBridge(bridgeUrl) {
  try {
    const res = await fetch(`${bridgeUrl}/api/agents`, {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const json = await res.json();
      return json.agents || [];
    }
  } catch (e) {
    console.log("[ContextLens] Bridge not available for agent detection:", e.message);
  }
  return [];
}

// Apply the activeModelId selection to appSettings (used by AI call functions)
function applyActiveModelToAppSettings() {
  // Try to find the active model in configured API models
  const apiModel = configuredApiModels.find(m => m.id === activeModelId);
  if (apiModel) {
    appSettings.apiProvider = apiModel.provider;
    appSettings.apiKey = apiModel.apiKey || "";
    appSettings.apiUrl = apiModel.apiUrl || "";
    appSettings.modelName = apiModel.model || "";
    appSettings.cwd = "";
    appSettings.claudePath = "";
    if (appSettings.providers[apiModel.provider]) {
      appSettings.providers[apiModel.provider].apiKey = apiModel.apiKey || "";
      appSettings.providers[apiModel.provider].apiUrl = apiModel.apiUrl || "";
      appSettings.providers[apiModel.provider].modelName = apiModel.model || "";
    }
    renderAvailableModelCards();
    return;
  }

  // Try to find the active model in detected local agents
  const localAgent = detectedLocalAgents.find(a => a.id === activeModelId && a.available);
  if (localAgent) {
    appSettings.apiProvider = localAgent.id;
    appSettings.apiKey = "";
    appSettings.apiUrl = DEFAULT_BRIDGE_URL;
    appSettings.modelName = localAgent.id;
    appSettings.cwd = "";
    appSettings.claudePath = localAgent.executablePath || "";
    renderAvailableModelCards();
    return;
  }

  // No active model matched: try to pick a first available one
  const firstLocal = detectedLocalAgents.find(a => a.available);
  if (firstLocal) {
    activeModelId = firstLocal.id;
    applyActiveModelToAppSettings();
    return;
  }

  const firstApi = configuredApiModels[0];
  if (firstApi) {
    activeModelId = firstApi.id;
    applyActiveModelToAppSettings();
    return;
  }

  // Nothing configured
  appSettings.apiProvider = "gemini";
  appSettings.apiKey = "";
  appSettings.modelName = "";
  renderAvailableModelCards();
}

// Render the model card list in basic settings panel
function renderAvailableModelCards() {
  if (!modelCardList) return;
  modelCardList.innerHTML = "";

  // Build unified list: detected local agents + configured API models
  const cards = [];

  // Local agents from bridge
  for (const agent of detectedLocalAgents) {
    const icons = { "claude-agent": "🤖", "codex-agent": "⚡", "gemini-agent": "🌟" };
    cards.push({
      id: agent.id,
      type: "local",
      icon: icons[agent.id] || "💻",
      name: agent.label,
      sub: agent.available ? (agent.version ? `v${agent.version} · 本地 CLI` : "本地 CLI") : "未安装",
      badge: agent.available ? "local" : "unavailable",
      badgeText: agent.available ? "本地" : "未安装",
      disabled: !agent.available,
      deletable: false,
      agentRef: agent
    });
  }

  // Configured API models
  for (const model of configuredApiModels) {
    const providerIcons = { gemini: "🌟", openai: "🤖", claude: "🧠", custom: "⚡" };
    cards.push({
      id: model.id,
      type: "api",
      icon: providerIcons[model.provider] || "☁️",
      name: model.label || model.provider,
      sub: model.model,
      badge: "api",
      badgeText: "API",
      disabled: false,
      deletable: true,
      modelRef: model
    });
  }

  // Update status text
  if (modelCardsStatus) {
    const localAvail = detectedLocalAgents.filter(a => a.available).length;
    const bridgeRunning = detectedLocalAgents.length > 0;
    if (!bridgeRunning) {
      modelCardsStatus.textContent = `Bridge 未连接（本地 Agent 不可用）· ${configuredApiModels.length} 个 API 模型`;
    } else {
      modelCardsStatus.textContent = `${localAvail} 个本地 Agent · ${configuredApiModels.length} 个 API 模型`;
    }
  }

  if (cards.length === 0) {
    modelCardList.innerHTML = `
      <div class="model-card-empty">
        <strong>尚无可用模型</strong>
        点击右上角「添加 API 模型」配置 Gemini/OpenAI 等 API 密钥，或启动 Bridge 服务以自动探测本地 Agent
      </div>
    `;
    return;
  }

  for (const card of cards) {
    const el = document.createElement("div");
    el.className = `model-card${card.disabled ? " disabled" : ""}${card.id === activeModelId ? " active" : ""}`;
    el.dataset.modelId = card.id;

    el.innerHTML = `
      <div class="model-card-icon">${card.icon}</div>
      <div class="model-card-info">
        <div class="model-card-name">${card.name}</div>
        <div class="model-card-sub">
          <span class="model-card-badge ${card.badge}">${card.badgeText}</span>
          ${card.sub ? `<span>${card.sub}</span>` : ""}
        </div>
      </div>
      <div class="model-card-side">
        ${card.id === activeModelId ? '<div class="model-card-active-indicator"></div>' : ""}
        ${card.deletable ? `
          <button class="model-card-edit" title="编辑" data-edit-id="${card.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="model-card-delete" title="删除" data-delete-id="${card.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        ` : ""}
      </div>
    `;

    if (!card.disabled) {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".model-card-delete")) return;
        if (e.target.closest(".model-card-edit")) return;
        // Activate this model
        activeModelId = card.id;
        applyActiveModelToAppSettings();
        renderAvailableModelCards();
      });
    } else {
      el.title = "需要安装此 CLI 工具或启动 Bridge";
    }

    // Edit handler for configured API models
    const editBtn = el.querySelector(".model-card-edit");
    if (editBtn) {
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (window._openEditApiModelModal) {
          window._openEditApiModelModal(editBtn.dataset.editId);
        }
      });
    }

    // Delete handler for configured API models
    const delBtn = el.querySelector(".model-card-delete");
    if (delBtn) {
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const deleteId = delBtn.dataset.deleteId;
        configuredApiModels = configuredApiModels.filter(m => m.id !== deleteId);
        await chrome.storage.local.set({ configuredApiModels });
        if (activeModelId === deleteId) {
          activeModelId = null;
        }
        applyActiveModelToAppSettings();
        renderAvailableModelCards();
      });
    }

    modelCardList.appendChild(el);
  }
}


// Legacy stubs (kept for url-rules and chat logic that still uses syncFormToProviderCache)
function syncFormToProviderCache(provider) {
  // No-op: form fields no longer exist in General tab; all settings tracked via configuredApiModels
}

function loadProviderCacheToForm(provider) {
  // No-op: General tab no longer has provider form
}



// Setup Event Listeners
function setupEventListeners() {
  // Insights Accordion Toggle
  const insightsToggle = document.getElementById("insights-toggle");
  const contextInsights = document.getElementById("context-insights");
  if (insightsToggle && contextInsights) {
    insightsToggle.addEventListener("click", () => {
      contextInsights.classList.toggle("open");
    });
  }

  // Drawer Toggle
  settingsToggle.addEventListener("click", async () => {
    await loadSettings(); // Reset to saved settings to discard unsaved edits
    toggleDrawer(true);
  });
  settingsClose.addEventListener("click", () => toggleDrawer(false));
  configureNowBtn.addEventListener("click", async () => {
    await loadSettings(); // Reset to saved settings
    toggleDrawer(true);
  });
  document.querySelector(".drawer-overlay").addEventListener("click", () => toggleDrawer(false));

  // Provider change (no-op in new UI - provider is determined by selected model card)
  // add-model-btn removed in new UI; add-api-model-btn replaces it

  // Temp slider
  modelTemperature.addEventListener("input", (e) => {
    tempVal.textContent = e.target.value;
  });

  // Save active model button
  const settingsSaveBtn = document.getElementById("settings-save-btn");
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener("click", async () => {
      if (!activeModelId) {
        showSettingsStatus("请先点击选择一个模型！", "error");
        return;
      }
      const temp = parseFloat(modelTemperature.value);
      appSettings.temperature = temp;

      // Persist active model id and temperature
      await chrome.storage.local.set({
        activeModelId,
        temperature: temp,
        providers: appSettings.providers,
        configuredApiModels
      });

      showSettingsStatus("已保存！正在应用...", "success");
      applyActiveModelToAppSettings();

      // Update defaultSettingsBackup so rules can restore back to this new default
      defaultSettingsBackup = {
        apiProvider: appSettings.apiProvider,
        temperature: appSettings.temperature,
        apiKey: appSettings.apiKey,
        apiUrl: appSettings.apiUrl,
        modelName: appSettings.modelName,
        cwd: "",
        claudePath: appSettings.claudePath,
        providers: JSON.parse(JSON.stringify(appSettings.providers))
      };

      await evaluateUrlSwitchingForActiveTab();
      updateStatusUI();

      setTimeout(() => toggleDrawer(false), 700);
    });
  }

  // Refresh local agents button
  const refreshAgentsBtn = document.getElementById("refresh-agents-btn");
  if (refreshAgentsBtn) {
    refreshAgentsBtn.addEventListener("click", () => {
      refreshAgentsBtn.style.opacity = "0.5";
      refreshAgentsBtn.disabled = true;
      fetchLocalAgentsFromBridge(DEFAULT_BRIDGE_URL).then(agents => {
        detectedLocalAgents = agents;
        applyActiveModelToAppSettings();
        updateStatusUI();
      }).finally(() => {
        refreshAgentsBtn.style.opacity = "";
        refreshAgentsBtn.disabled = false;
      });
    });
  }

  // Open Add API Model modal
  const addApiModelBtn = document.getElementById("add-api-model-btn");
  const addApiModelModal = document.getElementById("add-api-model-modal");
  const closeApiModalBtn = document.getElementById("close-api-modal-btn");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");
  const modalSaveBtn = document.getElementById("modal-save-btn");
  const modalProviderGrid = document.getElementById("modal-provider-grid");
  const modalKeyGroup = document.getElementById("modal-key-group");
  const modalUrlGroup = document.getElementById("modal-url-group");
  const modalApiKey = document.getElementById("modal-api-key");
  const modalApiUrl = document.getElementById("modal-api-url");
  const modalModelName = document.getElementById("modal-model-name");
  const modalModelLabel = document.getElementById("modal-model-label");
  const modalModelHint = document.getElementById("modal-model-hint");
  const modalToggleKey = document.getElementById("modal-toggle-key");
  const modalStatus = document.getElementById("modal-status");
  const modalTitle = document.getElementById("modal-title");

  let modalSelectedProvider = "gemini";
  let editingModelId = null; // null = add mode, non-null = edit mode

  const providerHints = {
    gemini: "常用: gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash",
    openai: "常用: gpt-4o, gpt-4o-mini, gpt-4-turbo",
    claude: "常用: claude-3-5-sonnet-latest, claude-3-haiku-20240307",
    custom: "需要填写 Base URL。兼容 OpenAI 格式的服务（如 Ollama, LM Studio）"
  };

  const providerDefaultModels = {
    gemini: "gemini-2.5-flash",
    openai: "gpt-4o-mini",
    claude: "claude-3-5-sonnet-latest",
    custom: ""
  };

  function applyProviderToModal(provider) {
    modalSelectedProvider = provider;
    if (modalProviderGrid) {
      modalProviderGrid.querySelectorAll(".provider-chip").forEach(c => {
        c.classList.toggle("active", c.dataset.provider === provider);
      });
    }
    if (modalModelHint) modalModelHint.textContent = providerHints[provider] || "";
    if (provider === "custom") {
      if (modalUrlGroup) modalUrlGroup.classList.remove("hidden");
      if (modalKeyGroup) modalKeyGroup.classList.remove("hidden");
    } else {
      if (modalUrlGroup) modalUrlGroup.classList.add("hidden");
      if (modalKeyGroup) modalKeyGroup.classList.remove("hidden");
      // Hide model list container when switching to non-custom provider
      const modalModelListContainer = document.getElementById("modal-model-list-container");
      if (modalModelListContainer) modalModelListContainer.classList.add("hidden");
    }
  }

  function openAddApiModelModal() {
    editingModelId = null;
    if (modalTitle) modalTitle.textContent = "添加 API 模型";
    if (modalSaveBtn) modalSaveBtn.textContent = "添加";
    applyProviderToModal("gemini");
    if (modalApiKey) { modalApiKey.value = ""; modalApiKey.type = "password"; }
    if (modalApiUrl) modalApiUrl.value = "";
    if (modalModelName) modalModelName.value = providerDefaultModels.gemini;
    if (modalModelLabel) modalModelLabel.value = "";
    if (modalStatus) { modalStatus.textContent = ""; modalStatus.className = "settings-status"; }
    // Hide model list container when opening modal in add mode
    const modalModelListContainer = document.getElementById("modal-model-list-container");
    if (modalModelListContainer) modalModelListContainer.classList.add("hidden");
    if (addApiModelModal) addApiModelModal.classList.remove("hidden");
  }

  // Expose globally so renderAvailableModelCards can call it
  window._openEditApiModelModal = function(modelId) {
    const model = configuredApiModels.find(m => m.id === modelId);
    if (!model) return;
    editingModelId = modelId;
    if (modalTitle) modalTitle.textContent = "编辑模型配置";
    if (modalSaveBtn) modalSaveBtn.textContent = "保存";
    applyProviderToModal(model.provider || "gemini");
    if (modalApiKey) { modalApiKey.value = model.apiKey || ""; modalApiKey.type = "password"; }
    if (modalApiUrl) modalApiUrl.value = model.apiUrl || "";
    if (modalModelName) modalModelName.value = model.model || "";
    if (modalModelLabel) modalModelLabel.value = model.label || "";
    if (modalStatus) { modalStatus.textContent = ""; modalStatus.className = "settings-status"; }
    // Hide model list container when opening modal in edit mode
    const modalModelListContainer = document.getElementById("modal-model-list-container");
    if (modalModelListContainer) modalModelListContainer.classList.add("hidden");
    if (addApiModelModal) addApiModelModal.classList.remove("hidden");
  };

  function closeModal() {
    if (addApiModelModal) addApiModelModal.classList.add("hidden");
    editingModelId = null;
  }

  if (addApiModelBtn) addApiModelBtn.addEventListener("click", openAddApiModelModal);
  if (closeApiModalBtn) closeApiModalBtn.addEventListener("click", closeModal);
  if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeModal);
  if (addApiModelModal) {
    addApiModelModal.addEventListener("click", (e) => {
      if (e.target === addApiModelModal) closeModal();
    });
  }

  // Provider chip selection in modal
  if (modalProviderGrid) {
    modalProviderGrid.addEventListener("click", (e) => {
      const chip = e.target.closest(".provider-chip");
      if (!chip) return;
      applyProviderToModal(chip.dataset.provider);
      // Only auto-fill model name if in add mode
      if (!editingModelId && modalModelName) {
        modalModelName.value = providerDefaultModels[modalSelectedProvider] || "";
      }
      if (!editingModelId && modalModelLabel) {
        modalModelLabel.value = "";
      }
    });
  }

  // Toggle API key visibility in modal
  if (modalToggleKey && modalApiKey) {
    modalToggleKey.addEventListener("click", () => {
      const t = modalApiKey.getAttribute("type") === "password" ? "text" : "password";
      modalApiKey.setAttribute("type", t);
    });
  }

  // Save API model (handles both add and edit modes)
  if (modalSaveBtn) {
    modalSaveBtn.addEventListener("click", async () => {
      const provider = modalSelectedProvider;
      const apiKeyVal = modalApiKey ? modalApiKey.value.trim() : "";
      const apiUrlVal = modalApiUrl ? modalApiUrl.value.trim() : "";
      const modelVal = modalModelName ? modalModelName.value.trim() : "";
      const labelVal = modalModelLabel ? modalModelLabel.value.trim() : "";

      // Validate
      if (!modelVal) {
        if (modalStatus) { modalStatus.textContent = "请填写模型标识符！"; modalStatus.className = "settings-status error"; }
        return;
      }
      if (provider !== "custom" && !apiKeyVal) {
        if (modalStatus) { modalStatus.textContent = "请填写 API 密钥！"; modalStatus.className = "settings-status error"; }
        return;
      }
      if (provider === "custom" && !apiUrlVal) {
        if (modalStatus) { modalStatus.textContent = "自定义 API 必须填写 Base URL！"; modalStatus.className = "settings-status error"; }
        return;
      }

      const autoLabel = labelVal || `${provider.charAt(0).toUpperCase() + provider.slice(1)} / ${modelVal}`;

      if (editingModelId) {
        // Edit mode: update existing model in-place
        const idx = configuredApiModels.findIndex(m => m.id === editingModelId);
        if (idx !== -1) {
          configuredApiModels[idx] = {
            ...configuredApiModels[idx],
            provider,
            label: autoLabel,
            model: modelVal,
            apiKey: apiKeyVal,
            apiUrl: apiUrlVal
          };
          // If this was the active model, re-apply settings
          if (activeModelId === editingModelId) {
            applyActiveModelToAppSettings();
            updateStatusUI();
          }
        }
      } else {
        // Add mode: create new model entry
        const newModel = {
          id: `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          provider,
          label: autoLabel,
          model: modelVal,
          apiKey: apiKeyVal,
          apiUrl: apiUrlVal
        };
        configuredApiModels.push(newModel);
        // Auto-select the new model if none was active
        if (!activeModelId) {
          activeModelId = newModel.id;
          applyActiveModelToAppSettings();
        }
      }

      await chrome.storage.local.set({ configuredApiModels });

      // Update provider cache too for backwards compat
      if (appSettings.providers[provider]) {
        if (apiKeyVal) appSettings.providers[provider].apiKey = apiKeyVal;
        if (apiUrlVal) appSettings.providers[provider].apiUrl = apiUrlVal;
        if (modelVal) appSettings.providers[provider].modelName = modelVal;
      }

      closeModal();
      renderAvailableModelCards();
    });
  }



  sendBtn.addEventListener("click", handleSendMessage);

  // Auto-resize chat input textarea based on content
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = (chatInput.scrollHeight) + "px";
  });

  // Trigger send on Ctrl+Enter (or Cmd+Enter on macOS)
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); // Prevent standard newline insertion
      handleSendMessage(); // Send!
    } else if (e.key === "Enter" && !e.shiftKey) {
      // Let standard newline insertion happen without sending
    }
  });

  // Toggle visibility of full page simplified text in insights accordion when checked
  const includeFullPageToggle = document.getElementById("include-full-page-context");
  if (includeFullPageToggle) {
    includeFullPageToggle.addEventListener("change", () => {
      includeFullPageChecked = includeFullPageToggle.checked;
      if (currentTabId) {
        const state = getTabState(currentTabId);
        state.includeFullPageChecked = includeFullPageChecked;
      }

      const fullPageInsight = document.querySelector(".full-page-insight");
      if (fullPageInsight) {
        if (includeFullPageToggle.checked) {
          fullPageInsight.classList.remove("hidden");
          
          // Auto expand the insights accordion if closed, so the user sees the complete context immediately
          const contextInsights = document.getElementById("context-insights");
          if (contextInsights && !contextInsights.classList.contains("open")) {
            contextInsights.classList.add("open");
          }
        } else {
          fullPageInsight.classList.add("hidden");
        }
      }
      saveActiveTabState();
    });
  }

  // Clear current context banner
  clearContextBtn.addEventListener("click", async () => {
    currentContext = null;
    includeFullPageChecked = false;
    if (currentTabId) {
      const state = getTabState(currentTabId);
      state.currentContext = null;
      state.includeFullPageChecked = false;
    }

    contextBanner.classList.add("hidden");
    await chrome.storage.session.remove("lastSelection");
    
    // Reset full page context toggle checkbox
    const includeFullPageToggle = document.getElementById("include-full-page-context");
    if (includeFullPageToggle) {
      includeFullPageToggle.checked = false;
    }

    // If chat history is empty, show welcome screen again
    if (chatHistory.length === 0) {
      welcomeScreen.classList.remove("hidden");
      messagesList.classList.add("hidden");
    }

    saveActiveTabState();
  });

  // Settings Drawer Tabs Switching
  const tabGeneral = document.getElementById("tab-general");
  const tabRules = document.getElementById("tab-rules");
  const panelGeneral = document.getElementById("panel-general");
  const panelRules = document.getElementById("panel-rules");
  const ruleEditor = document.getElementById("rule-editor");

  if (tabGeneral && tabRules && panelGeneral && panelRules) {
    tabGeneral.addEventListener("click", () => {
      tabGeneral.classList.add("active");
      tabRules.classList.remove("active");
      panelGeneral.classList.remove("hidden");
      panelRules.classList.add("hidden");
      if (ruleEditor) ruleEditor.classList.add("hidden"); // close editor when switching tabs
    });

    tabRules.addEventListener("click", () => {
      tabRules.classList.add("active");
      tabGeneral.classList.remove("active");
      panelRules.classList.remove("hidden");
      panelGeneral.classList.add("hidden");
      renderRulesList(); // render rules list
    });
  }

  // Create Fallback Rule Click Handler (Guiding users to set default '*' rule)
  const createFallbackRuleBtn = document.getElementById("create-fallback-rule-btn");
  if (createFallbackRuleBtn) {
    createFallbackRuleBtn.addEventListener("click", () => {
      toggleDrawer(true);
      if (tabGeneral && tabRules && panelGeneral && panelRules) {
        tabGeneral.classList.remove("active");
        tabRules.classList.add("active");
        panelGeneral.classList.add("hidden");
        panelRules.classList.remove("hidden");
        renderRulesList();
      }
      openRuleEditor(null);
      
      const ruleNameInput = document.getElementById("rule-name");
      const rulePatternInput = document.getElementById("rule-pattern");
      const ruleProviderInput = document.getElementById("rule-provider");
      const ruleCwdInput = document.getElementById("rule-cwd");
      
      if (ruleNameInput) ruleNameInput.value = "默认全局工作区";
      if (rulePatternInput) rulePatternInput.value = "*";
      
      if (ruleProviderInput) {
        // Re-render models to get fresh list
        renderConfiguredModelsForRule();
        
        // Try to find and select a claude-agent option
        let found = false;
        for (let i = 0; i < ruleProviderInput.options.length; i++) {
          const opt = ruleProviderInput.options[i];
          if (opt.dataset.provider === "claude-agent") {
            ruleProviderInput.selectedIndex = i;
            found = true;
            break;
          }
        }
        
        // If claude-agent not found, just use first option
        if (!found && ruleProviderInput.options.length > 0) {
          ruleProviderInput.selectedIndex = 0;
        }
        
        const selectedOption = ruleProviderInput.options[ruleProviderInput.selectedIndex];
        const provider = selectedOption?.dataset?.provider || "claude-agent";
        toggleRuleCwdGroup(provider);
      }
      
      setTimeout(() => {
        if (ruleCwdInput) {
          ruleCwdInput.focus();
          ruleCwdInput.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 300);
    });
  }

  if (connectionStatusPill && modelQuickPopover) {
    connectionStatusPill.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!modelQuickPopover.classList.contains("hidden")) {
        closeModelQuickPopover();
        return;
      }
      await openModelQuickPopover();
    });
  }

  if (modelQuickCloseBtn) {
    modelQuickCloseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeModelQuickPopover();
    });
  }

  document.addEventListener("click", (e) => {
    if (!modelQuickPopover || modelQuickPopover.classList.contains("hidden")) return;
    const clickedInsidePopover = modelQuickPopover.contains(e.target);
    const clickedPill = connectionStatusPill && connectionStatusPill.contains(e.target);
    if (!clickedInsidePopover && !clickedPill) {
      closeModelQuickPopover();
    }
  });

  // Rules Manager Event Handlers
  const addRuleBtn = document.getElementById("add-rule-btn");
  const closeEditorBtn = document.getElementById("close-editor-btn");
  const cancelRuleBtn = document.getElementById("cancel-rule-btn");
  const ruleEditorForm = document.getElementById("rule-editor-form");
  const ruleProviderSelect = document.getElementById("rule-provider");

  if (addRuleBtn) {
    addRuleBtn.addEventListener("click", () => {
      openRuleEditor(null);
    });
  }

  if (closeEditorBtn) {
    closeEditorBtn.addEventListener("click", () => {
      if (ruleEditor) ruleEditor.classList.add("hidden");
    });
  }

  if (cancelRuleBtn) {
    cancelRuleBtn.addEventListener("click", () => {
      if (ruleEditor) ruleEditor.classList.add("hidden");
    });
  }

  if (ruleProviderSelect) {
    ruleProviderSelect.addEventListener("change", (e) => {
      const selectedOption = e.target.options[e.target.selectedIndex];
      const provider = selectedOption.dataset.provider || "gemini";
      toggleRuleCwdGroup(provider);
      // Model is already selected via the option, no need to render
    });
  }

  // Add listener for modal sync models button
  const modalSyncBtn = document.getElementById("modal-sync-models-btn");
  if (modalSyncBtn) {
    modalSyncBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await handleFetchCustomModels();
    });
  }

  if (ruleEditorForm) {
    ruleEditorForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const editIndexInput = document.getElementById("edit-rule-index");
      const ruleName = document.getElementById("rule-name").value.trim();
      const rulePattern = document.getElementById("rule-pattern").value.trim();
      const ruleProviderSelect = document.getElementById("rule-provider");
      const ruleCwd = document.getElementById("rule-cwd").value.trim();
      
      if (!ruleName || !rulePattern || !ruleProviderSelect.value) {
        alert("请填写所有必填字段");
        return;
      }
      
      // Extract provider and model from selected option
      const selectedOption = ruleProviderSelect.options[ruleProviderSelect.selectedIndex];
      const provider = selectedOption.dataset.provider || "gemini";
      const model = selectedOption.dataset.modelName || "";
      
      if (!provider || !model) {
        alert("请选择有效的模型");
        return;
      }
      
      const newRule = {
        name: ruleName,
        pattern: rulePattern,
        provider: provider,
        model: model,
        cwd: provider.endsWith("-agent") ? ruleCwd : "",
        enabled: true
      };
      
      const indexStr = editIndexInput.value;
      if (indexStr !== "") {
        const idx = parseInt(indexStr);
        newRule.enabled = urlSwitchRules[idx].enabled !== false;
        urlSwitchRules[idx] = newRule;
      } else {
        urlSwitchRules.push(newRule);
      }
      
      await saveRulesToStorage();
      if (ruleEditor) ruleEditor.classList.add("hidden");
      renderRulesList();
      await evaluateUrlSwitchingForActiveTab();
    });
  }
}

// Show validation status messages in drawer
function showSettingsStatus(msg, type) {
  settingsStatus.textContent = msg;
  settingsStatus.className = `settings-status ${type}`;
  
  setTimeout(() => {
    settingsStatus.className = "settings-status";
    settingsStatus.textContent = "";
  }, 3000);
}

// Toggle drawer visibility
function toggleDrawer(show) {
  if (show) {
    settingsDrawer.classList.remove("hidden");
  } else {
    settingsDrawer.classList.add("hidden");
  }
}

// toggleProviderFields is a no-op since provider form fields are no longer in the general tab.
// Provider-specific UI is handled via the modal.
function toggleProviderFields(provider) {
  // No-op: form fields removed from general tab; provider is determined by model card selection
}



// Render dynamic HTML inside model select block (list of models with active and delete actions)
function renderModelSelection(provider, selectedValue) {
  if (!modelListContainer) return;
  modelListContainer.innerHTML = "";

  // Hidden input to hold the selected model value, so standard form sync works perfectly
  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.id = "api-model";
  hiddenInput.value = selectedValue || "";
  modelListContainer.appendChild(hiddenInput);

  const predefined = providerModels[provider] || [];
  const added = addedProviderModels[provider] || [];
  const allModels = [...predefined, ...added];

  // If we have custom sync button, toggle its visibility in the header actions block
  const syncBtn = document.getElementById("modal-sync-models-btn");
  if (syncBtn) {
    if (provider === "custom") {
      syncBtn.classList.remove("hidden");
    } else {
      syncBtn.classList.add("hidden");
    }
  }

  if (allModels.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "model-list-empty";
    emptyMsg.textContent = "暂无配置的模型，请点击右上角「添加」按钮添加模型";
    modelListContainer.appendChild(emptyMsg);
    return;
  }

  allModels.forEach(m => {
    const item = document.createElement("div");
    item.className = "model-item";
    if (m.value === selectedValue) {
      item.classList.add("active");
    }

    const info = document.createElement("div");
    info.className = "model-item-info";

    const name = document.createElement("div");
    name.className = "model-item-name";
    name.textContent = m.label;

    const id = document.createElement("div");
    id.className = "model-item-id";
    id.textContent = m.value;

    info.appendChild(name);
    info.appendChild(id);
    item.appendChild(info);

    // Add delete button for user-added custom models
    const isAdded = added.some(am => am.value === m.value);
    if (isAdded) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "model-item-delete";
      deleteBtn.title = "删除此自定义模型";
      deleteBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation(); // Prevent selecting the model when clicking delete

        // Remove from addedProviderModels
        addedProviderModels[provider] = addedProviderModels[provider].filter(am => am.value !== m.value);
        await chrome.storage.local.set({ addedProviderModels: addedProviderModels });

        // If custom provider, also sync customModels for backwards compatibility
        if (provider === "custom") {
          customModels = customModels.filter(cm => cm !== m.value);
          await chrome.storage.local.set({ customModels: customModels });
        }

        // If the deleted model was currently active, select a fallback model
        let nextSelected = selectedValue;
        if (selectedValue === m.value) {
          const fallbackList = [...predefined, ...addedProviderModels[provider]];
          nextSelected = fallbackList.length > 0 ? fallbackList[0].value : "";
        }

        // Re-render and immediately update local active provider settings
        renderModelSelection(provider, nextSelected);
        const activeModelEl = document.getElementById("api-model");
        if (activeModelEl) {
          appSettings.providers[provider].modelName = activeModelEl.value;
        }
      });
      item.appendChild(deleteBtn);
    }

    item.addEventListener("click", () => {
      // Deactivate others
      modelListContainer.querySelectorAll(".model-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      hiddenInput.value = m.value;

      // Sync immediately to provider cache so it preserves
      appSettings.providers[provider].modelName = m.value;
    });

    modelListContainer.appendChild(item);
  });
}

// Fetch custom models from OpenAI-compatible or Ollama endpoints
async function handleFetchCustomModels() {
  const syncBtn = document.getElementById("modal-sync-models-btn");
  const modalStatus = document.getElementById("modal-status");
  
  // Read from modal form fields, not global stubs
  const modalApiUrl = document.getElementById("modal-api-url");
  const modalApiKey = document.getElementById("modal-api-key");
  
  const urlVal = modalApiUrl ? modalApiUrl.value.trim() : "";
  const keyVal = modalApiKey ? modalApiKey.value.trim() : "";
  
  if (!urlVal) {
    if (modalStatus) {
      modalStatus.textContent = "请先输入您的自定义 API 基准地址 (Base URL)。";
      modalStatus.className = "settings-status error";
    }
    return;
  }
  
  // Set loading state
  if (syncBtn) {
    syncBtn.classList.add("loading");
    syncBtn.disabled = true;
    syncBtn.querySelector("span").textContent = "正在同步...";
  }
  
  if (modalStatus) {
    modalStatus.textContent = "正在同步模型列表...";
    modalStatus.className = "settings-status";
  }
  
  // Clean URL
  let baseUrl = urlVal.endsWith("/") ? urlVal.slice(0, -1) : urlVal;
  
  // Define endpoints to try
  const endpoints = [
    `${baseUrl}/models`,
    `${baseUrl}/v1/models`
  ];
  
  // If it looks like Ollama native port, insert tags endpoint at higher priority
  if (baseUrl.includes("11434") && !baseUrl.includes("/api") && !baseUrl.includes("/v1")) {
    endpoints.unshift(`${baseUrl}/api/tags`);
  } else {
    endpoints.push(`${baseUrl}/api/tags`);
  }
  
  let success = false;
  let fetchedList = [];
  let lastError = "Could not fetch models from any standard endpoint.";
  
  const headers = { "Accept": "application/json" };
  if (keyVal) {
    headers["Authorization"] = `Bearer ${keyVal}`;
  }
  
  for (const targetUrl of endpoints) {
    try {
      console.log(`🔮 [ContextLens] Attempting to fetch models from: ${targetUrl}`);
      const res = await fetch(targetUrl, {
        method: "GET",
        headers: headers,
        mode: "cors"
      });
      
      if (res.ok) {
        const json = await res.json();
        fetchedList = parseFetchedModels(json);
        if (fetchedList.length > 0) {
          success = true;
          console.log(`🔮 [ContextLens] Successfully synced ${fetchedList.length} models from ${targetUrl}`);
          break;
        }
      } else {
        const text = await res.text().catch(() => "");
        console.warn(`🔮 [ContextLens] Endpoint ${targetUrl} returned status ${res.status}: ${text}`);
        lastError = `Status ${res.status} from ${targetUrl}`;
      }
    } catch (err) {
      console.warn(`🔮 [ContextLens] Failed to connect to ${targetUrl}:`, err.message);
      lastError = err.message;
    }
  }
  
  // Reset loading state
  if (syncBtn) {
    syncBtn.classList.remove("loading");
    syncBtn.disabled = false;
    syncBtn.querySelector("span").textContent = "同步可用模型";
  }
  
  if (success && fetchedList.length > 0) {
    customModels = fetchedList;
    customManualMode = false;
    addedProviderModels.custom = fetchedList.map(m => ({ value: m, label: m }));
    
    // Save caches immediately to storage
    await chrome.storage.local.set({ 
      customModels: customModels,
      addedProviderModels: addedProviderModels
    });
    
    // Select existing model name if matched, else fallback to first fetched model
    const currentModelEl = document.getElementById("api-model");
    let modelToSelect = fetchedList[0];
    if (currentModelEl && fetchedList.includes(currentModelEl.value)) {
      modelToSelect = currentModelEl.value;
    } else if (appSettings.modelName && fetchedList.includes(appSettings.modelName)) {
      modelToSelect = appSettings.modelName;
    }
    
    renderModelSelection("custom", modelToSelect);
    
    // Display fetched models in the modal list for quick selection
    const modalModelList = document.getElementById("modal-model-list");
    const modalModelListContainer = document.getElementById("modal-model-list-container");
    
    if (modalModelList && modalModelListContainer) {
      modalModelList.innerHTML = "";
      
      fetchedList.forEach(modelName => {
        const item = document.createElement("div");
        item.className = "modal-model-item";
        if (modelName === modelToSelect) {
          item.classList.add("active");
        }
        item.textContent = modelName;
        
        item.addEventListener("click", () => {
          // Update the model name field
          document.getElementById("modal-model-name").value = modelName;
          
          // Update active state
          modalModelList.querySelectorAll(".modal-model-item").forEach(el => {
            el.classList.remove("active");
          });
          item.classList.add("active");
        });
        
        modalModelList.appendChild(item);
      });
      
      modalModelListContainer.classList.remove("hidden");
    }
    
    if (modalStatus) {
      modalStatus.textContent = `✓ 成功同步了 ${fetchedList.length} 个模型！`;
      modalStatus.className = "settings-status success";
    }
  } else {
    // Hide the model list container if sync fails
    const modalModelListContainer = document.getElementById("modal-model-list-container");
    if (modalModelListContainer) {
      modalModelListContainer.classList.add("hidden");
    }
    
    if (modalStatus) {
      modalStatus.textContent = `✗ 同步失败：${lastError}`;
      modalStatus.className = "settings-status error";
    }
  }
}

// Parse model list from standard formats
function parseFetchedModels(responseJson) {
  let list = [];
  if (!responseJson) return list;
  
  // Case 1: Standard OpenAI { data: [ { id: "model-id" }, ... ] }
  if (Array.isArray(responseJson.data)) {
    list = responseJson.data.map(m => typeof m === 'object' ? (m.id || m.name) : m).filter(Boolean);
  }
  // Case 2: Ollama native { models: [ { name: "model-name" }, ... ] }
  else if (Array.isArray(responseJson.models)) {
    list = responseJson.models.map(m => typeof m === 'object' ? (m.name || m.model || m.id) : m).filter(Boolean);
  }
  // Case 3: Flat array responses
  else if (Array.isArray(responseJson)) {
    list = responseJson.map(m => typeof m === 'object' ? (m.id || m.name) : m).filter(Boolean);
  }
  
  // Clean and deduplicate
  return [...new Set(list)].map(item => String(item).trim()).filter(Boolean);
}

function updateStatusUI() {
  const cwdWarningBanner = document.getElementById("cwd-warning-banner");
  const isLocalAgent = appSettings.apiProvider.endsWith("-agent");
  const hasModel = !!appSettings.modelName;
  const hasKey = appSettings.apiKey || isLocalAgent || appSettings.apiProvider === "custom";
  
  if (hasModel && (hasKey || isLocalAgent)) {
    connectionStatusPill.className = "status-pill online";
    
    let displayName = appSettings.modelName;
    if (isLocalAgent) {
      const agentLabel = (detectedLocalAgents.find(a => a.id === appSettings.apiProvider) || {}).label || appSettings.modelName;
      displayName = agentLabel;
    } else {
      // Always show the effective model name (including URL-rule or temporary overrides).
      displayName = appSettings.modelName;
    }

    connectedModelName.textContent = displayName;
    
    chatInput.disabled = false;
    chatInput.placeholder = "针对所选上下文进行提问... (Ctrl + Enter 发送)";
    sendBtn.disabled = false;
    
    if (cwdWarningBanner) cwdWarningBanner.classList.add("hidden");
  } else {
    connectionStatusPill.className = "status-pill offline";
    connectedModelName.textContent = hasModel ? "未配置 API 密钥" : "未配置 AI 模型";
    
    chatInput.disabled = true;
    chatInput.placeholder = hasModel ? "请配置 API 密钥..." : "请先在设置中选择并保存一个模型...";
    sendBtn.disabled = true;
    
    if (cwdWarningBanner) cwdWarningBanner.classList.add("hidden");
  }

  const hasTemporaryOverride = !!(currentTabId && tabTemporaryModelOverrides[currentTabId]);
  connectionStatusPill.classList.toggle("temporary", hasTemporaryOverride);
  if (hasTemporaryOverride) {
    if (!connectedModelName.textContent.endsWith("（临时）")) {
      connectedModelName.textContent = `${connectedModelName.textContent}（临时）`;
    }
  }
}


// --- CORE CHAT LOGIC ---

// Handle selected text arrivals
// Rebuild the complete UI for the active tab
function rebuildUIForActiveTab() {
  const includeFullPageToggle = document.getElementById("include-full-page-context");

  // 1. Re-render Context Banner
  if (currentContext) {
    contextText.textContent = `"${currentContext.text}"`;
    
    // Format source page label
    if (currentContext.pageTitle) {
      contextSourcePage.innerHTML = `
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
        ${currentContext.pageTitle}
      `;
      contextSourcePage.setAttribute("title", currentContext.pageUrl);
    } else {
      contextSourcePage.textContent = currentContext.pageUrl || "Webpage";
    }

    // --- RENDER DOM CONTEXT INSIGHTS ---
    const contextInsights = document.getElementById("context-insights");
    const insightsContent = document.getElementById("insights-content");
    const insightsBadge = document.getElementById("insights-badge");

    if (contextInsights && insightsContent && insightsBadge) {
      contextInsights.classList.remove("open"); // Reset accordion to closed state
      
      if (currentContext.contextData) {
        contextInsights.classList.remove("hidden");
        insightsContent.innerHTML = ""; // Clear previous details
        
        const cd = currentContext.contextData;
        let badgeLabel = "上下文视窗";
        
        // 1. Webpage Summary (Meta Description)
        if (cd.pageDescription) {
          const sect = document.createElement("div");
          sect.className = "insight-section";
          sect.innerHTML = `
            <div class="insight-title">网页摘要</div>
            <div class="insight-text text-type" style="color: #0d9488; font-style: normal;">${escapeHTML(cd.pageDescription)}</div>
          `;
          insightsContent.appendChild(sect);
        }

        // 2. DOM Semantic Breadcrumb Path
        if (cd.semanticPath) {
          const sect = document.createElement("div");
          sect.className = "insight-section";
          sect.innerHTML = `
            <div class="insight-title">DOM 语义路径</div>
            <div class="insight-text heading-type" style="font-family: monospace; color: #0891b2; font-size: 11px; font-weight: normal; word-break: break-all;">${escapeHTML(cd.semanticPath)}</div>
          `;
          insightsContent.appendChild(sect);
        }

        // 3. Parent Heading Title
        if (cd.parentHeading) {
          const sect = document.createElement("div");
          sect.className = "insight-section";
          sect.innerHTML = `
            <div class="insight-title">所属父级主题 / 章节</div>
            <div class="insight-text heading-type">${escapeHTML(cd.parentHeading)}</div>
          `;
          insightsContent.appendChild(sect);
        }
        
        // 4. Code Block Enclosure
        if (cd.contentType === "code" && cd.codeBlock) {
          badgeLabel = `代码上下文: ${cd.codeBlock.language.toUpperCase()}`;
          const sect = document.createElement("div");
          sect.className = "insight-section";
          sect.innerHTML = `
            <div class="insight-title">包围代码块 (${escapeHTML(cd.codeBlock.language)})</div>
            <div class="insight-text">${escapeHTML(cd.codeBlock.fullCode)}</div>
          `;
          insightsContent.appendChild(sect);
        }
        
        // 5. Table Structure Enclosure
        if (cd.contentType === "table" && cd.tableBlock) {
          badgeLabel = "表格上下文";
          const sect = document.createElement("div");
          sect.className = "insight-section";
          sect.innerHTML = `
            <div class="insight-title">包围表格 Markdown</div>
            <div class="insight-text table-type">${escapeHTML(cd.tableBlock)}</div>
          `;
          insightsContent.appendChild(sect);
        }
        
        // 6. Surrounding text sliding window
        if (cd.contentType === "text" && (cd.surroundingBefore || cd.surroundingAfter)) {
          badgeLabel = "段落上下文";
          const sect = document.createElement("div");
          sect.className = "insight-section";
          
          let displayHTML = "";
          if (cd.surroundingBefore) {
            displayHTML += `<span style="opacity: 0.6;">... ${escapeHTML(cd.surroundingBefore)}</span>`;
          }
          displayHTML += ` <strong style="color: #4f46e5; text-shadow: 0 0 8px rgba(79, 70, 229, 0.2);">[ ${escapeHTML(cd.selectedText)} ]</strong> `;
          if (cd.surroundingAfter) {
            displayHTML += `<span style="opacity: 0.6;">${escapeHTML(cd.surroundingAfter)} ...</span>`;
          }
          
          sect.innerHTML = `
            <div class="insight-title">包围段落上下文</div>
            <div class="insight-text text-type">${displayHTML}</div>
          `;
          insightsContent.appendChild(sect);
        }

        // 7. Full Page Text Context (Visible only when checkbox is checked)
        if (cd.fullPageSimplifiedText) {
          const sect = document.createElement("div");
          sect.className = `insight-section full-page-insight ${includeFullPageChecked ? "" : "hidden"}`;
          sect.innerHTML = `
            <div class="insight-title">完整文章正文 (将作为附加文章上下文发送给 Agent)</div>
            <div class="insight-text text-type" style="white-space: pre-wrap; font-family: monospace; font-size: 11px; max-height: 200px; overflow-y: auto; background: rgba(0, 0, 0, 0.025); padding: 8px; border-radius: 6px; user-select: text; text-align: left;">${escapeHTML(cd.fullPageSimplifiedText)}</div>
          `;
          insightsContent.appendChild(sect);
        }
        
        insightsBadge.textContent = badgeLabel;
      } else {
        contextInsights.classList.add("hidden");
      }
    }

    // Handle Full Page Context checkbox visibility
    const includeFullPageContainer = document.querySelector(".full-page-toggle-container");
    if (includeFullPageContainer && includeFullPageToggle) {
      if (currentContext.contextData && currentContext.contextData.fullPageSimplifiedText) {
        includeFullPageContainer.classList.remove("hidden");
        includeFullPageToggle.checked = includeFullPageChecked;
      } else {
        includeFullPageContainer.classList.add("hidden");
        includeFullPageToggle.checked = false;
        includeFullPageChecked = false;
      }
    }

    contextBanner.classList.remove("hidden");
  } else {
    contextBanner.classList.add("hidden");
    const includeFullPageContainer = document.querySelector(".full-page-toggle-container");
    if (includeFullPageContainer) {
      includeFullPageContainer.classList.add("hidden");
    }
    if (includeFullPageToggle) {
      includeFullPageToggle.checked = false;
    }
    includeFullPageChecked = false;
  }

  // 2. Re-render Chat History
  messagesList.innerHTML = "";
  if (chatHistory && chatHistory.length > 0) {
    chatHistory.forEach(msg => {
      const isUser = msg.role === "user";
      const msgEl = document.createElement("div");
      msgEl.className = `message ${msg.role}`;
      const contentToDisplay = msg.displayText || msg.content;
      const isAgentMsg = !!(msg.systemLogs || msg.agentLabel);
      if (!isUser) {
        if (isAgentMsg) msgEl.classList.add("agent-message");
        msgEl.innerHTML = `
          <span class="message-sender">Lens</span>
          <div class="message-bubble${isAgentMsg ? " agent-bubble" : ""}"></div>
        `;
        const bubble = msgEl.querySelector(".message-bubble");
        renderAssistantMessage(
          bubble,
          msg.content,
          msg.systemLogs,
          msg.isAgentComplete !== false,
          msg.agentLabel
        );
      } else {
        msgEl.innerHTML = `
          <span class="message-sender">您</span>
          <div class="message-bubble">${formatMarkdown(contentToDisplay)}</div>
        `;
      }
      messagesList.appendChild(msgEl);
    });

    welcomeScreen.classList.add("hidden");
    messagesList.classList.remove("hidden");
  } else {
    if (currentContext) {
      welcomeScreen.classList.add("hidden");
      messagesList.classList.remove("hidden");
    } else {
      welcomeScreen.classList.remove("hidden");
      messagesList.classList.add("hidden");
    }
  }

  // Scroll active view to top if it's just selection view, or bottom if there is chat
  if (chatHistory && chatHistory.length > 0) {
    scrollToBottom();
  } else {
    const chatContainer = document.querySelector(".chat-container");
    if (chatContainer) {
      chatContainer.scrollTop = 0;
    }
  }
}

// Handle selected text arrivals
async function handleNewSelection(selection, isNewInteraction = false) {
  if (!selection) return;

  const tabId = selection.tabId || currentTabId;
  if (!tabId) return;

  saveActiveTabState();

  const state = getTabState(tabId);
  if (selection.text || selection.contextData) {
    state.currentContext = selection;
    state.includeFullPageChecked = false; // Reset to unchecked for safety

    // A new user-triggered selection (Lens button or right-click) resets the
    // chat for this tab so the conversation starts fresh with the new context.
    if (isNewInteraction) {
      // Cancel any in-progress stream
      if (tabId === currentTabId && activeReader) {
        try { await activeReader.cancel(); } catch(e) {}
        activeReader = null;
      }
      state.chatHistory = [];
    }
  }

  if (tabId === currentTabId) {
    restoreActiveTabState(currentTabId);
    rebuildUIForActiveTab();
    saveActiveTabState();
  } else {
    persistTabStates();
  }
}

// Send user message
async function handleSendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  const messageTabId = currentTabId; // Capture current tab ID at the start

  // Clear input area immediately
  chatInput.value = "";
  chatInput.style.height = "auto";

  // Hide welcome screen
  welcomeScreen.classList.add("hidden");
  messagesList.classList.remove("hidden");

  // Append user bubble
  appendMessage("user", text);

  // Sync to tab states cache immediately
  if (messageTabId) {
    const state = getTabState(messageTabId);
    state.chatHistory = [...chatHistory];
    persistTabStates();
  }

  // Send request to AI
  let fullPrompt = text;

  // Determine cwd strictly from URL rule matching.
  // Only when the current page matches an enabled agent rule should we pass a workspace path to local CLI agents.
  const _isAgentProvider = appSettings.apiProvider.endsWith("-agent");
  let _pageUrl = (currentContext && currentContext.pageUrl) ? currentContext.pageUrl : "";
  if (!_pageUrl && messageTabId) {
    try {
      const tab = await chrome.tabs.get(messageTabId);
      _pageUrl = tab && tab.url ? tab.url : "";
    } catch {}
  }

  const matchedRuleForRequest = _pageUrl ? findMatchingRule(_pageUrl) : null;
  const matchedRuleCwd = matchedRuleForRequest && matchedRuleForRequest.provider === appSettings.apiProvider
    ? (matchedRuleForRequest.cwd || "").trim()
    : "";
  const effectiveCwd = _isAgentProvider && matchedRuleCwd ? matchedRuleCwd : "";

  // If we have selected text context, prepend/attach it
  if (currentContext && chatHistory.length === 1) {
    const cd = currentContext.contextData;
    if (cd) {
      const contextImages = getContextImages(cd, 5);
      if (appSettings.apiProvider.endsWith("-agent") && effectiveCwd) {
        // Agent mode: only for local/dev pages with workspace configured
          const workspaceHeader = `You are a local agentic coding assistant running directly in the user's project workspace folder: ${effectiveCwd}.`;
          const targetCodebaseLine = "Your goal is to search the local workspace codebase to locate the file defining this UI element/text, and modify it in place according to their instructions.";
          const step1 = `1. Search the local workspace codebase using tools like grep, find, or search to find the source file (React/Vue components, HTML, JS, TS, CSS, JSON, or template files) that contains the selected UI text "${cd.selectedText}" or matches this surrounding context.`;
          const step2 = `2. Edit the file directly in the local workspace codebase to perform the user's instructions: "${text}".`;

        // Specialized agentic instructions for codebase edits
          fullPrompt = `${workspaceHeader}
The user is viewing a web page and selected a specific element/text. ${targetCodebaseLine}

[Page Context]
Title: ${currentContext.pageTitle}
URL: ${currentContext.pageUrl}
${cd.pageDescription ? `Description/Summary: ${cd.pageDescription}` : ""}
${cd.parentHeading ? `Section Heading: ${cd.parentHeading}` : ""}
${cd.semanticPath ? `DOM Path Location: ${cd.semanticPath}` : ""}

[Webpage Content Context]
`;

        if (cd.contentType === "code" && cd.codeBlock) {
          fullPrompt += `This selection lies inside a code block (Language: ${cd.codeBlock.language || "unspecified"}).
Here is the FULL surrounding code block:
\`\`\`${cd.codeBlock.language || ""}
${cd.codeBlock.fullCode}
\`\`\`

The user highlighted the following specific line(s)/part:
"${cd.selectedText}"
`;
        } else if (cd.contentType === "table" && cd.tableBlock) {
          fullPrompt += `This selection lies inside a structured data table.
Here is the simplified Markdown table representing the headers and active row:
${cd.tableBlock}

The user highlighted the following specific cell text:
"${cd.selectedText}"
`;
        } else {
          fullPrompt += `Here are the surrounding paragraphs for context:
... ${cd.surroundingBefore || ""} [SELECTED TEXT: "${cd.selectedText}"] ${cd.surroundingAfter || ""} ...
`;
        }

        fullPrompt += buildImageContextBlock(contextImages);

        // Append simplified full-page context if checkbox is checked
        const includeFullPageToggle = document.getElementById("include-full-page-context");
        if (includeFullPageToggle && includeFullPageToggle.checked && cd.fullPageSimplifiedText) {
          fullPrompt += `\n[Full Page Simplified Context]\nBelow is a token-efficient, simplified extraction of the main body of this webpage:\n"""\n${cd.fullPageSimplifiedText}\n"""\n`;
        }

        fullPrompt += `
[User Prompt / Instructions]
${text}

[Goal & Execution Steps]
${step1}
${step2}
3. Verify your changes and output a concise summary of the changes and the git diff.
`;
      } else {
        // Standard non-agent prompt
        fullPrompt = `You are helping the user analyze a webpage snippet inside a larger page context.
Here are the rich details captured from the active browser tab:

[Page Context]
Title: ${currentContext.pageTitle}
URL: ${currentContext.pageUrl}
Note for Agent: You are provided with the direct URL of this webpage/article. If the provided snippet or page context is insufficient, or if you need to fetch/pull the complete, updated or original contents of the webpage/article to provide a better answer, you can fetch or browse it using the URL provided above.
${cd.pageDescription ? `Description/Summary: ${cd.pageDescription}` : ""}
${cd.parentHeading ? `Section Heading: ${cd.parentHeading}` : ""}
${cd.semanticPath ? `DOM Path Location: ${cd.semanticPath}` : ""}

[Webpage Content Context]
`;

        if (cd.contentType === "code" && cd.codeBlock) {
          fullPrompt += `This selection lies inside a code block (Language: ${cd.codeBlock.language || "unspecified"}).
        
Here is the FULL surrounding code block:
\`\`\`${cd.codeBlock.language || ""}
${cd.codeBlock.fullCode}
\`\`\`

The user highlighted the following specific line(s)/part:
"${cd.selectedText}"
`;
        } else if (cd.contentType === "table" && cd.tableBlock) {
          fullPrompt += `This selection lies inside a structured data table.

Here is the simplified Markdown table representing the headers and active row:
${cd.tableBlock}

The user highlighted the following specific cell text:
"${cd.selectedText}"
`;
        } else {
          // Text type with surrounding paragraphs (sliding window)
          fullPrompt += `Here are the surrounding paragraphs (sliding window) for context:
... ${cd.surroundingBefore || ""} [SELECTED TEXT: "${cd.selectedText}"] ${cd.surroundingAfter || ""} ...
`;
        }

        fullPrompt += buildImageContextBlock(contextImages);

        // Append simplified full-page context if checkbox is checked
        const includeFullPageToggle = document.getElementById("include-full-page-context");
        if (includeFullPageToggle && includeFullPageToggle.checked && cd.fullPageSimplifiedText) {
          fullPrompt += `\n[Full Page Simplified Context]\nBelow is a token-efficient, simplified extraction of the main body of this webpage:\n"""\n${cd.fullPageSimplifiedText}\n"""\n`;
        }

        fullPrompt += `\n[User Prompt / Instructions]\n${text}`;
      }
    } else {
      // Basic context fallback
      if (appSettings.apiProvider.endsWith("-agent") && effectiveCwd) {
        // Agent mode: only for local/dev pages with workspace configured
        const workspaceHeader = `You are a local agentic coding assistant running directly in the user's project workspace folder: ${effectiveCwd}.`;
        const targetCodebaseLine = "The user is viewing a web page and selected a specific element/text. Your goal is to search the local workspace codebase to locate the file defining this UI element/text, and modify it in place according to their instructions.";
        const step1 = `1. Search the local workspace codebase using tools like grep, find, or search to find the source file (React/Vue components, HTML, JS, TS, CSS, JSON, or template files) containing the selected UI text "${currentContext.text}".`;
        const step2 = `2. Edit the file directly in the local workspace codebase to perform the user's instructions: "${text}".`;

        fullPrompt = `${workspaceHeader}
${targetCodebaseLine}

Page Title: ${currentContext.pageTitle}
Page URL: ${currentContext.pageUrl}
Selected Snippet: "${currentContext.text}"

[User Prompt / Instructions]
${text}

[Goal & Execution Steps]
${step1}
${step2}
3. Verify your changes and output a concise summary of the changes and the git diff.`;
      } else {
        fullPrompt = `You are helping the user analyze a webpage snippet.
Selected Snippet: "${currentContext.text}"
Page Title: ${currentContext.pageTitle}
Page URL: ${currentContext.pageUrl}
Note for Agent: You are provided with the direct URL of this webpage/article. If the provided snippet or page context is insufficient, or if you need to fetch/pull the complete, updated or original contents of the webpage/article to provide a better answer, you can fetch or browse it using the URL provided above.

User Question: ${text}`;
      }
    }

    // Update the actual saved message content in history 
    // so that all subsequent turns will carry over the rich webpage context!
    // Also set a flag so API callers know history[0] already contains full context.
    if (chatHistory.length > 0) {
      chatHistory[0].displayText = chatHistory[0].displayText || chatHistory[0].content;
      chatHistory[0].content = fullPrompt;
      chatHistory[0]._contextEmbedded = true; // mark as having context already embedded
      if (messageTabId) {
        const state = getTabState(messageTabId);
        state.chatHistory = [...chatHistory];
        persistTabStates();
      }
    }
  }

  await triggerAIStreamResponse(fullPrompt, messageTabId, effectiveCwd);
}

// Append a bubble element to the chat stream
function appendMessage(role, text) {
  const isUser = role === "user";
  const msgEl = document.createElement("div");
  msgEl.className = `message ${role}`;
  
  if (!isUser) {
    msgEl.innerHTML = `
      <span class="message-sender">Lens</span>
      <div class="message-bubble"></div>
    `;
    const bubble = msgEl.querySelector(".message-bubble");
    renderAssistantMessage(bubble, text, null, true, null);
  } else {
    msgEl.innerHTML = `
      <span class="message-sender">您</span>
      <div class="message-bubble">${formatMarkdown(text)}</div>
    `;
  }

  messagesList.appendChild(msgEl);
  chatHistory.push({ role, content: text });
  
  // Scroll to bottom
  scrollToBottom();

  return msgEl;
}

// Scroll chat list container to bottom
function scrollToBottom() {
  const container = document.querySelector(".chat-container");
  container.scrollTop = container.scrollHeight;
}

// Unified Streaming Handler
async function triggerAIStreamResponse(promptText, messageTabId, effectiveCwd = "") {
  const targetTabId = messageTabId || currentTabId;

  // If a reader is active, abort it
  if (activeReader) {
    try {
      await activeReader.cancel();
    } catch(e) {}
    activeReader = null;
  }

  // Check configs
  if (!appSettings.apiKey && appSettings.apiProvider !== "custom" && !appSettings.apiProvider.endsWith("-agent")) {
    appendMessage("assistant", "⚠️ ContextLens 尚未完成配置。请点击右上角打开 AI 服务端配置面板，填写您的 API 密钥并保存！");
    return;
  }

  // Append temporary loading placeholder assistant bubble if targetTabId is active
  const assistantBubble = document.createElement("div");
  assistantBubble.className = "message assistant agent-message";
  assistantBubble.innerHTML = `
    <span class="message-sender">Lens</span>
    <div class="message-bubble agent-bubble">
      <div class="stream-loading">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    </div>
  `;
  
  if (targetTabId === currentTabId) {
    messagesList.appendChild(assistantBubble);
    scrollToBottom();
  }

  const bubbleContent = targetTabId === currentTabId ? assistantBubble.querySelector(".message-bubble") : null;
  let streamedText = "";
  let systemLogsText = "";

  // Register the stream bubble immediately in the target tab's history
  const targetState = getTabState(targetTabId);
  const assistantMsgObj = { role: "assistant", content: "", isAgentComplete: false };
  targetState.chatHistory.push(assistantMsgObj);
  if (targetTabId === currentTabId) {
    chatHistory = [...targetState.chatHistory];
  }

  try {
    const { apiProvider, apiKey, apiUrl, modelName, temperature } = appSettings;
    const contextImages = getContextImages(currentContext?.contextData, 5);
    const canUseStructuredImages = supportsStructuredImageInput(apiProvider, modelName);
    let response;
    let reader;

    // --- GEMINI API STREAM ---
    if (apiProvider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?key=${apiKey}`;
      
      // Package conversation history in Gemini format
      const contents = [];
      
      // Inject System Instruction as standard model instructions or a system prompt
      // For simplicity and compatibility, we inject system instructions in the first prompt
      let geminiSystem = SYSTEM_PROMPT;
      if (currentContext) {
        geminiSystem += `\nSelected Context:\nSnippet: "${currentContext.text}"\nSource: ${currentContext.pageTitle}\nURL: ${currentContext.pageUrl}\nNote for Agent: You are provided with the direct URL of this webpage/article. If the provided snippet or page context is insufficient, or if you need to fetch/pull the complete, updated or original contents of the webpage/article to provide a better answer, you can fetch or browse it using the URL provided above.`;
      }

      // Add history (Gemini format: role 'user' or 'model')
      // Retrieve the first user message (which now has full context if updated)
      const firstMsgContent = chatHistory[0]?.content || promptText;
      contents.push({
        role: "user",
        parts: [{ text: `${geminiSystem}\n\nUser starts the session with:\n${firstMsgContent}` }]
      });

      // Append follow-up chat history (excluding the final assistant streaming bubble)
      for (let i = 1; i < chatHistory.length - 1; i++) {
        const msg = chatHistory[i];
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }]
        });
      }

      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: contents,
          generationConfig: { temperature: temperature }
        })
      });

      if (!response.ok) {
        const errObj = await response.json().catch(() => ({}));
        throw new Error(errObj.error?.message || `Gemini API returned status ${response.status}`);
      }

      reader = response.body.getReader();
      activeReader = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      if (targetTabId === currentTabId && bubbleContent) {
        bubbleContent.innerHTML = ""; // Clear loader dots
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Gemini returns streaming elements inside a large JSON array-like structure.
        // Chunks are formatted as: [ { "candidates": ... }, { "candidates": ... } ]
        // We parse each JSON object block using a regex or simple scanning.
        
        // Find clean JSON blocks in stream buffer
        let boundaryIdx;
        while ((boundaryIdx = buffer.indexOf("}\n,")) !== -1 || (boundaryIdx = buffer.indexOf("}\r\n,")) !== -1) {
          const splitLen = buffer.includes("\r\n") ? 3 : 2;
          const chunkStr = buffer.slice(0, boundaryIdx + 1).trim();
          buffer = buffer.slice(boundaryIdx + splitLen);
          
          // Clean up brackets for correct parsing
          let cleanStr = chunkStr;
          if (cleanStr.startsWith("[")) cleanStr = cleanStr.substring(1);
          if (cleanStr.endsWith("]")) cleanStr = cleanStr.substring(0, cleanStr.length - 1);
          
          try {
            const parsed = JSON.parse(cleanStr);
            const textChunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textChunk) {
              streamedText += textChunk;
              assistantMsgObj.content = streamedText;
              if (targetTabId === currentTabId) {
                let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                if (!activeBubble) activeBubble = bubbleContent;
                if (activeBubble) {
                  renderAssistantMessage(activeBubble, streamedText, null, true, null);
                }
                scrollToBottom();
              }
            }
          } catch (e) {
            // Partial JSON, skip to keep buffer
          }
        }
      }

      // Handle final remaining buffer in stream
      if (buffer.trim()) {
        let cleanStr = buffer.trim();
        if (cleanStr.startsWith("[")) cleanStr = cleanStr.substring(1);
        if (cleanStr.endsWith("]")) cleanStr = cleanStr.substring(0, cleanStr.length - 1);
        if (cleanStr.endsWith("}")) {
          try {
            const parsed = JSON.parse(cleanStr);
            const textChunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textChunk) {
              streamedText += textChunk;
              assistantMsgObj.content = streamedText;
              if (targetTabId === currentTabId) {
                let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                if (!activeBubble) activeBubble = bubbleContent;
                if (activeBubble) {
                  activeBubble.innerHTML = formatMarkdown(streamedText);
                  activeBubble.querySelectorAll(".think-block[open] .think-content").forEach(el => {
                    el.scrollTop = el.scrollHeight;
                  });
                }
              }
            }
          } catch(e) {}
        }
      }

    // --- OPENAI or CUSTOM OPENAI-COMPATIBLE API STREAM ---
    } else if (apiProvider === "openai" || apiProvider === "custom") {
      const url = apiProvider === "openai" ? "https://api.openai.com/v1/chat/completions" : `${apiUrl}/chat/completions`;
      
      const headers = { "Content-Type": "application/json" };
      if (apiProvider === "openai" && apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      } else if (apiProvider === "custom" && apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      // Prepare system context
      // Only inject selected text into system prompt if it hasn't already been
      // embedded into chatHistory[0] as a fullPrompt (avoid duplicate context)
      let systemContent = SYSTEM_PROMPT;
      if (currentContext && !chatHistory[0]?._contextEmbedded) {
        systemContent += `\nSelected context from webpage "${currentContext.pageTitle}":\n"${currentContext.text}"\nURL: ${currentContext.pageUrl}\nNote for Agent: You are provided with the direct URL of this webpage/article. If the provided snippet or page context is insufficient, or if you need to fetch/pull the complete, updated or original contents of the webpage/article to provide a better answer, you can fetch or browse it using the URL provided above.`;
      }

      // Compile chat history messages
      const messages = [{ role: "system", content: systemContent }];

      // Add existing chat logs (excluding the final assistant streaming bubble)
      for (let i = 0; i < chatHistory.length - 1; i++) {
        const msg = chatHistory[i];
        const shouldEmbedImages = i === 0
          && msg.role === "user"
          && msg._contextEmbedded
          && canUseStructuredImages
          && contextImages.length > 0;

        if (shouldEmbedImages) {
          const contentParts = [{ type: "text", text: msg.content }];
          contextImages.forEach((img) => {
            contentParts.push({
              type: "image_url",
              image_url: { url: img.src }
            });
          });
          messages.push({ role: msg.role, content: contentParts });
        } else {
          messages.push({ role: msg.role, content: msg.content });
        }
      }

      response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          model: modelName,
          messages: messages,
          temperature: temperature,
          stream: true
        })
      });

      if (!response.ok) {
        const errObj = await response.json().catch(() => ({}));
        throw new Error(errObj.error?.message || `API returned status ${response.status}`);
      }

      reader = response.body.getReader();
      activeReader = reader;
      const decoder = new TextDecoder();
      if (targetTabId === currentTabId && bubbleContent) {
        bubbleContent.innerHTML = ""; // Clear loader dots
      }

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last partial line in buffer
        buffer = lines.pop();

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine || !cleanLine.startsWith("data: ")) continue;
          
          const rawData = cleanLine.substring(6);
          if (rawData === "[DONE]") break;

          try {
            const parsed = JSON.parse(rawData);
            const contentChunk = parsed.choices?.[0]?.delta?.content;
            const reasoningChunk = parsed.choices?.[0]?.delta?.reasoning_content;
            if (contentChunk || reasoningChunk) {
              if (reasoningChunk) {
                if (!assistantMsgObj._hasThinkTag) {
                  streamedText += "<think>";
                  assistantMsgObj._hasThinkTag = true;
                }
                streamedText += reasoningChunk;
              } else {
                if (assistantMsgObj._hasThinkTag && !assistantMsgObj._thinkTagClosed) {
                  streamedText += "</think>";
                  assistantMsgObj._thinkTagClosed = true;
                }
                if (contentChunk) {
                  streamedText += contentChunk;
                }
              }
              assistantMsgObj.content = streamedText;
              if (targetTabId === currentTabId) {
                let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                if (!activeBubble) activeBubble = bubbleContent;
                if (activeBubble) {
                  renderAssistantMessage(activeBubble, streamedText, null, true, null);
                }
                scrollToBottom();
              }
            }
          } catch(e) {
            // Partial SSE line
          }
        }
      }

    // --- ANTHROPIC CLAUDE API STREAM ---
    } else if (apiProvider === "claude") {
      const url = "https://api.anthropic.com/v1/messages";
      
      // Build Claude prompt
      // Only inject selected text into system prompt if it hasn't already been
      // embedded into chatHistory[0] as a fullPrompt (avoid duplicate context)
      let systemContent = SYSTEM_PROMPT;
      if (currentContext && !chatHistory[0]?._contextEmbedded) {
        systemContent += `\nSelected context from webpage "${currentContext.pageTitle}":\n"${currentContext.text}"\nURL: ${currentContext.pageUrl}\nNote for Agent: You are provided with the direct URL of this webpage/article. If the provided snippet or page context is insufficient, or if you need to fetch/pull the complete, updated or original contents of the webpage/article to provide a better answer, you can fetch or browse it using the URL provided above.`;
      }

      const messages = [];
      // Compile chat history messages (excluding the final assistant streaming bubble)
      for (let i = 0; i < chatHistory.length - 1; i++) {
        messages.push({
          role: chatHistory[i].role === "assistant" ? "assistant" : "user",
          content: chatHistory[i].content
        });
      }

      response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "dangerously-allow-browser": "true"
        },
        body: JSON.stringify({
          model: modelName,
          messages: messages,
          system: systemContent,
          max_tokens: 4000,
          temperature: temperature,
          stream: true
        })
      });

      if (!response.ok) {
        const errObj = await response.json().catch(() => ({}));
        throw new Error(errObj.error?.message || `Claude API returned status ${response.status}`);
      }

      reader = response.body.getReader();
      activeReader = reader;
      const decoder = new TextDecoder();
      if (targetTabId === currentTabId && bubbleContent) {
        bubbleContent.innerHTML = "";
      }

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;

          if (cleanLine.startsWith("data: ")) {
            const rawData = cleanLine.substring(6);
            try {
              const parsed = JSON.parse(rawData);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                streamedText += parsed.delta.text;
                assistantMsgObj.content = streamedText;
                if (targetTabId === currentTabId) {
                  let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                  if (!activeBubble) activeBubble = bubbleContent;
                  if (activeBubble) {
                    renderAssistantMessage(activeBubble, streamedText, null, true, null);
                  }
                  scrollToBottom();
                }
              }
            } catch(e) {}
          }
        }
      }
    } else if (apiProvider.endsWith("-agent")) {
      // Stream via local Node Bridge
      const url = `${apiUrl}/api/chat`;
      
      let promptToSend = promptText;
      if (chatHistory.length > 2) {
        let historyPrompt = "You are working in a multi-turn session. Here is the conversation history so far for your reference:\n\n";
        for (let i = 0; i < chatHistory.length - 2; i++) {
          const msg = chatHistory[i];
          const sender = msg.role === "user" ? "User" : "Assistant";
          historyPrompt += `--- ${sender} ---\n${msg.content}\n\n`;
        }
        historyPrompt += `--- Current User Request ---\n${promptText}`;
        promptToSend = historyPrompt;
      }

      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptToSend,
          cwd: effectiveCwd,
          claudePath: appSettings.claudePath || "",
          agentId: apiProvider
        })
      });

      if (!response.ok) {
        const errObj = await response.json().catch(() => ({}));
        throw new Error(errObj.error || `本地 Bridge 返回错误: ${response.status}`);
      }

      reader = response.body.getReader();
      activeReader = reader;
      const decoder = new TextDecoder();

      let agentLabel = "本地 Agent";
      const matchingAgent = detectedLocalAgents.find(a => a.id === apiProvider);
      if (matchingAgent) agentLabel = `本地 ${matchingAgent.label}`;
      else if (apiProvider === "claude-agent") agentLabel = "本地 Claude Code CLI";
      else if (apiProvider === "codex-agent") agentLabel = "本地 Codex CLI";
      else if (apiProvider === "gemini-agent") agentLabel = "本地 Gemini CLI";

      systemLogsText = `正在启动并初始化${agentLabel}...\n`;

      if (targetTabId === currentTabId && bubbleContent) {
        renderAssistantMessage(bubbleContent, "", systemLogsText, false, agentLabel);
      }

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;

          if (cleanLine.startsWith("data: ")) {
            const rawData = cleanLine.substring(6).trim();
            if (rawData === "[DONE]") {
              // Mark the progress box as complete
              assistantMsgObj.isAgentComplete = true;
              assistantMsgObj.systemLogs = systemLogsText;
              assistantMsgObj.agentLabel = agentLabel;
              
              if (targetTabId === currentTabId) {
                let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                if (!activeBubble) activeBubble = bubbleContent;
                if (activeBubble) {
                  renderAssistantMessage(activeBubble, streamedText, systemLogsText, true, agentLabel);
                }
              }
              break;
            }

            try {
              const parsed = JSON.parse(rawData);
              
              if (parsed.type === "text" && parsed.text) {
                streamedText += parsed.text;
                assistantMsgObj.content = streamedText;
                
                if (targetTabId === currentTabId) {
                  let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                  if (!activeBubble) activeBubble = bubbleContent;
                  if (activeBubble) {
                    renderAssistantMessage(activeBubble, streamedText, systemLogsText, false, agentLabel);
                  }
                  scrollToBottom();
                }
              } else if (parsed.type === "system" && parsed.text) {
                systemLogsText += parsed.text;
                assistantMsgObj.systemLogs = systemLogsText;
                
                if (targetTabId === currentTabId) {
                  let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                  if (!activeBubble) activeBubble = bubbleContent;
                  if (activeBubble) {
                    renderAssistantMessage(activeBubble, streamedText, systemLogsText, false, agentLabel);
                  }
                  scrollToBottom();
                }
              } else if (parsed.type === "error" && parsed.text) {
                streamedText += `\n${parsed.text}\n`;
                assistantMsgObj.content = streamedText;
                
                if (targetTabId === currentTabId) {
                  let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                  if (!activeBubble) activeBubble = bubbleContent;
                  if (activeBubble) {
                    renderAssistantMessage(activeBubble, streamedText, systemLogsText, false, agentLabel);
                  }
                  scrollToBottom();
                }
              }
            } catch (e) {
              // Ignore JSON parse errors for partial lines
            }
          }
        }
      }
    }

    activeReader = null;
    assistantMsgObj.isAgentComplete = true;
    if (targetTabId === currentTabId) {
      saveActiveTabState();
    } else {
      persistTabStates();
    }

  } catch (err) {
    console.error("ContextLens AI stream failed:", err);
    const errMsg = `⚠️ API 请求发送失败: ${err.message || "网络错误。"}`;
    assistantMsgObj.content = errMsg;

    if (targetTabId === currentTabId) {
      let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
      if (!activeBubble) activeBubble = bubbleContent;
      if (activeBubble) {
        let errorTitle = "API 请求发送失败";
        let errorDesc = err.message || "发生未知网络连接错误。请检查您的网络连接、API 密钥以及自定义服务端基准地址是否正确。";
        
        if (appSettings.apiProvider.endsWith("-agent")) {
          errorTitle = "无法连接到本地 Bridge 服务";
          errorDesc = `请确认您已在项目目录下执行下列命令启动 Bridge 服务：<br><code style="background:rgba(220,38,38,0.08);color:#dc2626;padding:2px 4px;border-radius:4px;font-family:monospace;margin-top:4px;display:inline-block;">node bridge/server.js</code><br><br>错误信息: ${err.message}`;
        }
        
        activeBubble.innerHTML = `
          <div style="color: #dc2626; border: 1px solid rgba(220, 38, 38, 0.15); background: rgba(220, 38, 38, 0.04); padding: 8px 12px; border-radius: 8px; font-size: 13px; display: flex; flex-direction: column; gap: 4px;">
            <span style="font-weight: bold; display: flex; align-items: center; gap: 4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              ${errorTitle}
            </span>
            <span>${errorDesc}</span>
          </div>
        `;
      }
    }
    activeReader = null;
    assistantMsgObj.isAgentComplete = true;
    if (targetTabId === currentTabId) {
      saveActiveTabState();
    } else {
      persistTabStates();
    }
  }
}

// Safe HTML Escaper utility
function escapeHTML(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Split agent stdout to isolate prompt and answer
function splitAgentOutput(text, isComplete = false) {
  if (!text) return { promptContext: "", actualAnswer: "" };

  // Resilient regex for separator matching (case insensitive, flexible whitespace/newlines)
  const separatorRegex = /3\.\s*Verify\s+your\s+changes\s+and\s+output\s+a\s+concise\s+summary\s+of\s+the\s+changes\s+and\s+the\s+git\s+diff\.?/i;
  const match = text.match(separatorRegex);
  if (match) {
    const sepIndex = match.index;
    const sepLength = match[0].length;
    const promptContext = text.substring(0, sepIndex + sepLength).trim();
    const actualAnswer = text.substring(sepIndex + sepLength).trim();
    return { promptContext, actualAnswer };
  }

  const goalHeader = "[Goal & Execution Steps]";
  const goalIndex = text.indexOf(goalHeader);
  if (goalIndex !== -1 && text.trim().startsWith("You are a local agentic coding assistant")) {
    if (isComplete) {
      // Find where "3. " starts after the goalHeader index
      const item3Index = text.indexOf("3. ", goalIndex);
      if (item3Index !== -1) {
        const nextNewline = text.indexOf("\n", item3Index);
        if (nextNewline !== -1) {
          return {
            promptContext: text.substring(0, nextNewline).trim(),
            actualAnswer: text.substring(nextNewline).trim()
          };
        }
      }
    }
    return { promptContext: text.trim(), actualAnswer: "" };
  }

  if (text.trim().startsWith("You are a local agentic coding assistant") && text.length < 2500) {
    if (isComplete) {
      // Fallback split if completed but no exact match was found
      const promptInstructionsHeader = "[User Prompt / Instructions]";
      const instIndex = text.indexOf(promptInstructionsHeader);
      if (instIndex !== -1) {
        const stepsHeader = "[Goal & Execution Steps]";
        const stepsIndex = text.indexOf(stepsHeader, instIndex);
        if (stepsIndex !== -1) {
          const item3Index = text.indexOf("3. ", stepsIndex);
          if (item3Index !== -1) {
            const nextNewline = text.indexOf("\n", item3Index);
            if (nextNewline !== -1) {
              return {
                promptContext: text.substring(0, nextNewline).trim(),
                actualAnswer: text.substring(nextNewline).trim()
              };
            }
          }
        }
      }
    }
    return { promptContext: text.trim(), actualAnswer: "" };
  }

  return { promptContext: "", actualAnswer: text };
}

// Custom assistant message renderer for unified formatting of agents/LLMs
function renderAssistantMessage(bubbleEl, text, systemLogsText, isComplete, agentLabel) {
  if (!bubbleEl) return;

  // Detect if this is an agent response (has agentLabel or systemLogsText)
  const hasSystemLogs = typeof systemLogsText === "string";
  const isAgentResponse = !!(agentLabel || hasSystemLogs);
  const { promptContext, actualAnswer } = splitAgentOutput(text, isComplete);
  let html = "";

  // ── BLOCK 1: Prompt context card (collapsible) ──────────────────────────────
  if (promptContext) {
    const isOpen = !actualAnswer && !isComplete;
    html += `
      <details class="agent-block agent-prompt-card" ${isOpen ? "open" : ""}>
        <summary class="agent-block-header">
          <span class="agent-block-icon">📋</span>
          <span class="agent-block-title">输入上下文与任务步骤</span>
          <span class="agent-block-toggle">${isOpen ? "▼ 折叠" : "▶ 展开"}</span>
        </summary>
        <div class="agent-block-body agent-prompt-body">${escapeHTML(promptContext)}</div>
      </details>
    `;
  }

  // ── BLOCK 2: Execution log card (collapsible, status-aware) ─────────────────
  if (isAgentResponse && (hasSystemLogs || !isComplete)) {
    const displayLabel = agentLabel || "本地 Agent";
    const statusText = isComplete ? "Agent 执行完毕" : `${displayLabel} 运行中...`;
    const logDisplay = isComplete ? "none" : "block";
    const toggleIcon = isComplete ? "▶ 展开" : "▼ 折叠";
    const completedClass = isComplete ? "agent-log-card--done" : "";

    html += `
      <div class="agent-block agent-log-card ${completedClass}">
        <div class="agent-block-header agent-status-header">
          <span class="agent-block-icon">
            ${isComplete
              ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
              : `<svg class="spinning-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
            }
          </span>
          <span class="agent-block-title">${statusText}</span>
          <span class="agent-log-toggle agent-block-toggle">${toggleIcon}</span>
        </div>
        <div class="agent-block-body agent-log-body agent-log-content" style="display:${logDisplay};">${formatAgentLogs(systemLogsText || "正在启动并初始化...")}</div>
      </div>
    `;
  }

  // ── BLOCK 3: Result card (agent only) ────────────────────────────────────────
  if (isAgentResponse && (actualAnswer || (!promptContext && text))) {
    const resultContent = actualAnswer || text;
    html += `
      <div class="agent-block agent-result-card">
        <div class="agent-block-header agent-result-header">
          <span class="agent-block-icon">✦</span>
          <span class="agent-block-title">执行结果</span>
        </div>
        <div class="agent-block-body agent-result-body">
          ${formatMarkdown(resultContent)}
        </div>
      </div>
    `;
  }

  // If no agent blocks produced, render as plain markdown (non-agent response)
  if (!html) {
    if (!isAgentResponse && !isComplete && !text) {
      bubbleEl.innerHTML = `
        <div class="stream-loading">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      `;
      return;
    }
    bubbleEl.innerHTML = text ? formatMarkdown(text) : "";
    return;
  }

  // Mark the bubble as agent-layout so CSS strips the default bubble background
  bubbleEl.classList.add("agent-bubble");
  bubbleEl.innerHTML = html;

  // Auto-scroll internal scrollable containers to bottom
  const logBody = bubbleEl.querySelector(".agent-log-body");
  if (logBody) logBody.scrollTop = logBody.scrollHeight;
  bubbleEl.querySelectorAll(".think-block[open] .think-content").forEach(el => {
    el.scrollTop = el.scrollHeight;
  });

  // Bind toggle for execution log card
  const headerEl = bubbleEl.querySelector(".agent-status-header");
  if (headerEl) {
    headerEl.style.cursor = "pointer";
    headerEl.onclick = () => {
      const log = bubbleEl.querySelector(".agent-log-content");
      const toggle = headerEl.querySelector(".agent-log-toggle");
      if (!log) return;
      if (log.style.display === "none") {
        log.style.display = "block";
        if (toggle) toggle.textContent = "▼ 折叠";
      } else {
        log.style.display = "none";
        if (toggle) toggle.textContent = "▶ 展开";
      }
    };
  }

  // Bind toggle for prompt context card (details element)
  const contextDetails = bubbleEl.querySelector(".agent-prompt-card");
  if (contextDetails) {
    const summaryEl = contextDetails.querySelector("summary");
    if (summaryEl) {
      summaryEl.addEventListener("click", () => {
        setTimeout(() => {
          const toggle = summaryEl.querySelector(".agent-block-toggle");
          if (toggle) toggle.textContent = contextDetails.hasAttribute("open") ? "▼ 折叠" : "▶ 展开";
        }, 50);
      });
    }
  }
}

// --- UTILITY MARKDOWN PARSER ---

// Convert Markdown table to HTML table
function markdownTableToHTML(tableLines) {
  if (tableLines.length < 2) return "";
  
  // Parse header row
  const headerCells = tableLines[0]
    .split("|")
    .map(cell => cell.trim())
    .filter(cell => cell);
  
  // Parse separator row to detect alignment
  const separatorCells = tableLines[1]
    .split("|")
    .map(cell => cell.trim())
    .filter(cell => cell);
  
  const alignments = separatorCells.map(sep => {
    if (/^:-*:$/.test(sep)) return "center";
    if (/:$/.test(sep)) return "right";
    if (/^:/.test(sep)) return "left";
    return "";
  });
  
  // Parse data rows
  const dataRows = tableLines.slice(2).map(line =>
    line
      .split("|")
      .map(cell => cell.trim())
      .filter((_, idx) => idx < headerCells.length)
  );
  
  // Build HTML table
  let html = '<table class="md-table"><thead><tr>';
  
  headerCells.forEach((header, idx) => {
    const align = alignments[idx] ? ` style="text-align:${alignments[idx]}"` : "";
    html += `<th${align}>${applyInlineMarkdown(header)}</th>`;
  });
  
  html += '</tr></thead><tbody>';
  
  dataRows.forEach(row => {
    html += '<tr>';
    row.forEach((cell, idx) => {
      const align = alignments[idx] ? ` style="text-align:${alignments[idx]}"` : "";
      html += `<td${align}>${applyInlineMarkdown(cell)}</td>`;
    });
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  return html;
}

// Safe, lightweight markdown to HTML compiler
function formatMarkdown(text) {
  if (!text) return "";

  // ─── 0. Extract <think>...</think> blocks before any processing ───────────
  const thinkBlocks = [];
  const THINK_PH = (i) => `CTXLENS_THINK_${i}_PH`;

  text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, content) => {
    const idx = thinkBlocks.length;
    thinkBlocks.push({ content: content.trim(), open: false });
    return THINK_PH(idx);
  });

  const openMatch = text.match(/<think>([\s\S]*)$/i);
  if (openMatch) {
    const idx = thinkBlocks.length;
    thinkBlocks.push({ content: openMatch[1].trim(), open: true });
    text = text.replace(/<think>[\s\S]*$/i, THINK_PH(idx));
  }

  // ─── 1. Extract fenced code blocks to protect them from other transforms ──
  const codeBlocks = [];
  const CODE_PH = (i) => `CTXLENS_CODE_${i}_PH`;

  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    const escaped = code
      .trim()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    codeBlocks.push(`<pre><code class="language-${lang || "text"}">${escaped}</code></pre>`);
    return CODE_PH(idx);
  });

  // ─── 2. Escape remaining HTML ─────────────────────────────────────────────
  text = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // ─── 3. Collapse 3+ consecutive blank lines to 2 ─────────────────────────
  text = text.replace(/\n{3,}/g, "\n\n");

  // ─── 4. Process line by line for block elements ───────────────────────────
  const lines = text.split("\n");
  const outputParts = []; // array of HTML string segments

  // List state
  let listStack = []; // each entry: { type: 'ul'|'ol', indent: number }

  function flushLists(targetDepth = 0) {
    while (listStack.length > targetDepth) {
      const closed = listStack.pop();
      outputParts.push(`</${closed.type}>`);
    }
  }

  // Paragraph accumulator
  let paraLines = [];

  function flushPara() {
    if (paraLines.length === 0) return;
    const content = paraLines.join(" ").trim();
    if (content) {
      outputParts.push(`<p>${content}</p>`);
    }
    paraLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // ── Fenced code block placeholder (restore later) ──
    const codePHMatch = trimmed.match(/^CTXLENS_CODE_(\d+)_PH$/);
    if (codePHMatch) {
      flushPara();
      flushLists();
      outputParts.push(codeBlocks[parseInt(codePHMatch[1])]);
      continue;
    }

    // ── Think placeholder ──
    const thinkPHMatch = trimmed.match(/^CTXLENS_THINK_(\d+)_PH$/);
    if (thinkPHMatch) {
      flushPara();
      flushLists();
      // Will be restored in step 6; push the placeholder back as block
      outputParts.push(`<div class="think-ph-wrapper">${THINK_PH(parseInt(thinkPHMatch[1]))}</div>`);
      continue;
    }

    // ── Blank line: end current paragraph / list when appropriate ──
    if (trimmed === "") {
      flushPara();
      // Don't flush lists on single blank line — lists can have loose items
      continue;
    }

    // ── Markdown table detection ──
    // A table must have at least 2 lines: header | separator
    if (trimmed.startsWith("|") && i + 1 < lines.length) {
      const nextTrimmed = lines[i + 1].trim();
      // Check if next line is a valid table separator
      if (/^\|[\s\-:|]+\|?$/.test(nextTrimmed) && nextTrimmed.includes("---")) {
        flushPara();
        flushLists();
        
        // Parse table: start from current line, collect until we hit a non-table line
        const tableLines = [];
        let j = i;
        while (j < lines.length && /^\|/.test(lines[j].trim())) {
          tableLines.push(lines[j].trim());
          j++;
        }
        
        // Convert Markdown table to HTML
        if (tableLines.length >= 2) {
          const tableHTML = markdownTableToHTML(tableLines);
          outputParts.push(tableHTML);
          i = j - 1; // Skip the processed table lines
          continue;
        }
      }
    }

    // ── Headings: # h1, ## h2 ... ###### h6 ──
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushPara();
      flushLists();
      const level = headingMatch[1].length;
      const content = applyInlineMarkdown(headingMatch[2]);
      outputParts.push(`<h${level} class="md-h${level}">${content}</h${level}>`);
      continue;
    }

    // ── Horizontal rule: --- or *** or ___ (3+ chars) ──
    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushPara();
      flushLists();
      outputParts.push(`<hr class="md-hr">`);
      continue;
    }

    // ── Unordered list item: leading "- " or "* " or "+ " ──
    const ulMatch = raw.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
      flushPara();
      const indent = ulMatch[1].length;
      const content = applyInlineMarkdown(ulMatch[3]);

      // Determine nesting depth (1 level per 2 spaces or 1 tab)
      const depth = Math.floor(indent / 2) + 1;

      if (listStack.length === 0) {
        listStack.push({ type: "ul", indent });
        outputParts.push(`<ul class="md-ul">`);
      } else {
        const top = listStack[listStack.length - 1];
        if (indent > top.indent) {
          listStack.push({ type: "ul", indent });
          outputParts.push(`<ul class="md-ul">`);
        } else if (indent < top.indent) {
          while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
            const closed = listStack.pop();
            outputParts.push(`</${closed.type}>`);
            outputParts.push(`</li>`);
          }
        } else if (top.type !== "ul") {
          flushLists();
          listStack.push({ type: "ul", indent });
          outputParts.push(`<ul class="md-ul">`);
        }
      }
      outputParts.push(`<li>${content}</li>`);
      continue;
    }

    // ── Ordered list item: "1. " or "10. " etc ──
    const olMatch = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (olMatch) {
      flushPara();
      const indent = olMatch[1].length;
      const content = applyInlineMarkdown(olMatch[3]);

      if (listStack.length === 0) {
        listStack.push({ type: "ol", indent });
        outputParts.push(`<ol class="md-ol">`);
      } else {
        const top = listStack[listStack.length - 1];
        if (indent > top.indent) {
          listStack.push({ type: "ol", indent });
          outputParts.push(`<ol class="md-ol">`);
        } else if (indent < top.indent) {
          while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
            const closed = listStack.pop();
            outputParts.push(`</${closed.type}>`);
            outputParts.push(`</li>`);
          }
        } else if (top.type !== "ol") {
          flushLists();
          listStack.push({ type: "ol", indent });
          outputParts.push(`<ol class="md-ol">`);
        }
      }
      outputParts.push(`<li>${content}</li>`);
      continue;
    }

    // ── Normal text line: accumulate into paragraph ──
    // If we're inside a list but encounter a non-list line, it's a continuation
    if (listStack.length > 0) {
      // Likely a loose paragraph inside a list — close list first
      flushLists();
    }
    paraLines.push(applyInlineMarkdown(trimmed));
  }

  // Flush anything remaining
  flushPara();
  flushLists();

  let html = outputParts.join("\n");

  // ─── 5. Restore think placeholders inside wrapper divs ────────────────────
  for (let i = 0; i < thinkBlocks.length; i++) {
    const block = thinkBlocks[i];
    let escapedContent = block.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Apply inline formatting to think content
    escapedContent = escapedContent.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      const ec = code.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<pre><code class="language-${lang || "text"}">${ec}</code></pre>`;
    });
    escapedContent = applyInlineMarkdown(escapedContent);
    escapedContent = escapedContent.replace(/\n/g, "<br>");

    const thinkHTML = block.open
      ? `<details class="think-block" open><summary>💭 思考中...</summary><div class="think-content">${escapedContent}</div></details>`
      : `<details class="think-block"><summary>💭 思考过程</summary><div class="think-content">${escapedContent}</div></details>`;

    html = html.replace(`<div class="think-ph-wrapper">${THINK_PH(i)}</div>`, thinkHTML);
    // Also handle inline think placeholders
    html = html.replace(THINK_PH(i), thinkHTML);
  }

  return html;
}

// Apply inline markdown: bold, italic, inline code, strikethrough
function applyInlineMarkdown(text) {
  if (!text) return "";
  // Inline code (do first to avoid treating `` content as bold/italic)
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold + italic: ***text***
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold: **text**
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Bold: __text__
  text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  // Italic: *text*
  text = text.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  // Italic: _text_
  text = text.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  // Strikethrough: ~~text~~
  text = text.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  return text;
}



// Format local agent system logs into collapsible UI elements
function formatAgentLogs(text) {
  if (!text) return "";
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const markerLookahead = "(?=🔧|➡️|❌|💭|⚙️|✅|$)";

  html = html.replace(new RegExp(`💭 思考过程:\\n([\\s\\S]*?)\\n\\n${markerLookahead}`, "g"), (match, content) => {
    return `<details class="think-block"><summary>💭 思考过程</summary><div class="think-content">${content}</div></details>`;
  });
  
  html = html.replace(new RegExp(`🔧 调用工具: ([^\\n]+)\\n参数:\\n([\\s\\S]*?)\\n\\n${markerLookahead}`, "g"), (match, toolName, content) => {
    return `<details class="think-block"><summary>🔧 调用工具: ${toolName}</summary><div class="think-content">${content}</div></details>`;
  });

  html = html.replace(new RegExp(`➡️ 工具执行结果:\\n([\\s\\S]*?)\\n\\n${markerLookahead}`, "g"), (match, content) => {
    return `<details class="think-block"><summary>➡️ 工具执行结果</summary><div class="think-content">${content}</div></details>`;
  });

  html = html.replace(new RegExp(`❌ 工具执行失败:\\n([\\s\\S]*?)\\n\\n${markerLookahead}`, "g"), (match, content) => {
    return `<details class="think-block"><summary style="color:#ef4444">❌ 工具执行失败</summary><div class="think-content">${content}</div></details>`;
  });

  // Preserve any remaining newlines
  html = html.replace(/\n/g, "<br>");
  return html;
}

// --- URL AUTO-SWITCHING RULES FUNCTIONS ---

// Evaluate URL auto-switching rules for the current active tab
async function evaluateUrlSwitchingForActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      await applyUrlSwitchingForTab(tabs[0]);
    }
  } catch (e) {
    console.warn("Failed to evaluate URL auto-switching for active tab:", e);
  }
}

// Check tab URL and temporarily override default settings if a rule matches
async function applyUrlSwitchingForTab(tab) {
  if (!tab || !tab.url) {
    restoreDefaultSettings();
    return;
  }
  
  const url = tab.url;
  
  // Ignore internal Chrome/extension pages
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:")) {
    restoreDefaultSettings();
    return;
  }
  
  const matchedRule = findMatchingRule(url);
  if (matchedRule) {
    applyRuleSettings(matchedRule);
  } else {
    restoreDefaultSettings();
  }

  applyTemporaryModelOverrideForTab(tab.id);
}

// Score URL pattern specificity so generic catch-all patterns (like "*") lose to concrete rules.
function getRulePatternSpecificity(pattern) {
  if (!pattern || typeof pattern !== "string") return Number.NEGATIVE_INFINITY;
  const clean = pattern.trim().toLowerCase();
  if (!clean) return Number.NEGATIVE_INFINITY;
  if (clean === "*") return -1000;

  const wildcardCount = (clean.match(/\*/g) || []).length;
  const literalLength = clean.replace(/\*/g, "").length;
  const hasScheme = /^(https?:\/\/|file:\/\/)/.test(clean) ? 1 : 0;
  const anchoredStart = clean.startsWith("*") ? 0 : 1;
  const anchoredEnd = clean.endsWith("*") ? 0 : 1;

  return (
    literalLength * 10 +
    hasScheme * 40 +
    anchoredStart * 10 +
    anchoredEnd * 5 -
    wildcardCount * 3
  );
}

// Find best matched rule by specificity (more concrete patterns win)
function findMatchingRule(url) {
  if (!urlSwitchRules || !Array.isArray(urlSwitchRules)) return null;

  let bestRule = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const rule of urlSwitchRules) {
    if (rule.enabled === false) continue;
    if (!matchUrlPattern(url, rule.pattern)) continue;

    const score = getRulePatternSpecificity(rule.pattern);
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  return bestRule;
}

// Match glob wildcard patterns (* matches anything, fallback to case-insensitive substring)
function matchUrlPattern(url, pattern) {
  if (!pattern) return false;
  
  let cleanPattern = pattern.trim();
  if (!cleanPattern) return false;
  
  try {
    if (!cleanPattern.includes('*')) {
      return url.toLowerCase().includes(cleanPattern.toLowerCase());
    }
    
    // Convert glob pattern to regular expression
    let regexString = cleanPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*');
      
    const regex = new RegExp('^' + regexString + '$', 'i');
    
    // Match anywhere in the URL (substring match with wildcard)
    let flexibleRegexString = regexString;
    if (!cleanPattern.startsWith('*')) {
      flexibleRegexString = '.*' + flexibleRegexString;
    }
    if (!cleanPattern.endsWith('*')) {
      flexibleRegexString = flexibleRegexString + '.*';
    }
    
    const flexRegex = new RegExp('^' + flexibleRegexString + '$', 'i');
    return flexRegex.test(url) || regex.test(url);
  } catch (e) {
    console.error("URL Pattern matching regex parsing error:", e);
    return url.toLowerCase().includes(cleanPattern.toLowerCase());
  }
}

// Override appSettings dynamically with matched rule configuration
function applyRuleSettings(rule) {
  if (!defaultSettingsBackup) {
    // Safety fallback
    defaultSettingsBackup = {
      apiProvider: appSettings.apiProvider,
      temperature: appSettings.temperature,
      apiKey: appSettings.apiKey,
      apiUrl: appSettings.apiUrl,
      modelName: appSettings.modelName,
      cwd: appSettings.cwd,
      claudePath: appSettings.claudePath,
      providers: JSON.parse(JSON.stringify(appSettings.providers))
    };
  }
  
  // Override active provider and model
  appSettings.apiProvider = rule.provider;
  appSettings.modelName = rule.model;
  
  // Initialize provider properties
  const savedProvConfig = defaultSettingsBackup.providers[rule.provider] || {};
  appSettings.providers[rule.provider] = {
    ...appSettings.providers[rule.provider],
    modelName: rule.model
  };
  
  // Handle Claude Agent CWD overrides
  if (rule.provider.endsWith("-agent")) {
    appSettings.cwd = rule.cwd || savedProvConfig.cwd || "";
    if (appSettings.providers[rule.provider]) {
      appSettings.providers[rule.provider].cwd = rule.cwd || savedProvConfig.cwd || "";
    }
  }
  
  // Populate easy-lookup settings properties
  appSettings.apiKey = savedProvConfig.apiKey || "";
  appSettings.apiUrl = savedProvConfig.apiUrl || "";
  appSettings.claudePath = savedProvConfig.claudePath || "";
  
  updateStatusUI();
  
  // Show match indicator banner
  const banner = document.getElementById("rule-match-banner");
  const bannerText = document.getElementById("matched-rule-text");
  if (banner && bannerText) {
    bannerText.textContent = `已按 URL 匹配规则: ${rule.name}`;
    bannerText.setAttribute("title", `匹配模式: ${rule.pattern}\n供应商: ${rule.provider}\n模型: ${rule.model}${rule.cwd ? `\n工作区: ${rule.cwd}` : ''}`);
    banner.classList.remove("hidden");
  }
}

// Restore user default settings when leaving matching domains
function restoreDefaultSettings() {
  if (!defaultSettingsBackup) return;
  
  appSettings.apiProvider = defaultSettingsBackup.apiProvider;
  appSettings.temperature = defaultSettingsBackup.temperature;
  appSettings.apiKey = defaultSettingsBackup.apiKey;
  appSettings.apiUrl = defaultSettingsBackup.apiUrl;
  appSettings.modelName = defaultSettingsBackup.modelName;
  appSettings.cwd = defaultSettingsBackup.cwd;
  appSettings.claudePath = defaultSettingsBackup.claudePath;
  appSettings.providers = JSON.parse(JSON.stringify(defaultSettingsBackup.providers));
  
  updateStatusUI();
  
  const banner = document.getElementById("rule-match-banner");
  if (banner) {
    banner.classList.add("hidden");
  }
}

// Render the rules list in Settings tab 2
function renderRulesList() {
  const rulesList = document.getElementById("rules-list");
  if (!rulesList) return;
  
  rulesList.innerHTML = "";
  
  if (!urlSwitchRules || urlSwitchRules.length === 0) {
    rulesList.innerHTML = `
      <div class="empty-rules-state">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>暂无自动切换规则</p>
        <small>添加规则可在访问特定网站时自动切换 AI 供应商和工作路径</small>
      </div>
    `;
    return;
  }
  
  urlSwitchRules.forEach((rule, index) => {
    const card = document.createElement("div");
    card.className = `rule-card ${rule.enabled !== false ? "" : "disabled"}`;
    card.dataset.index = String(index);
    
    let providerLabel = rule.provider;
    if (rule.provider === "gemini") providerLabel = "Gemini";
    else if (rule.provider === "openai") providerLabel = "OpenAI";
    else if (rule.provider === "claude") providerLabel = "Claude";
    else if (rule.provider === "custom") providerLabel = "自定义";
    else if (rule.provider.endsWith("-agent")) providerLabel = "Local Agent";
    
    card.innerHTML = `
      <div class="rule-card-header">
        <div class="rule-card-info">
          <span class="rule-name-text">${escapeHTML(rule.name)}</span>
          <span class="rule-pattern-badge" title="匹配模式: ${escapeHTML(rule.pattern)}">${escapeHTML(rule.pattern)}</span>
        </div>
        <div class="rule-card-toggle">
          <label class="switch-label">
            <input type="checkbox" class="rule-toggle-checkbox" data-index="${index}" ${rule.enabled !== false ? "checked" : ""}>
            <span class="switch-custom"></span>
          </label>
        </div>
      </div>
      <div class="rule-card-body">
        <div class="rule-meta-inline">
          <span class="meta-kv">
            <span class="meta-key">供应商</span>
            <span class="meta-val">${providerLabel}</span>
          </span>
          <span class="meta-separator">•</span>
          <span class="meta-kv">
            <span class="meta-key">模型</span>
            <span class="meta-val font-mono">${escapeHTML(rule.model)}</span>
          </span>
        </div>
        ${rule.cwd ? `
        <div class="rule-meta-row">
          <span class="meta-label">工作区:</span>
          <span class="meta-value font-mono truncate" title="${escapeHTML(rule.cwd)}">${escapeHTML(rule.cwd)}</span>
        </div>
        ` : ""}
      </div>
      <div class="rule-card-actions">
        <div class="rule-order-actions">
          <button type="button" class="rule-action-btn move-up-btn" data-index="${index}" title="上移 (提高优先级)" ${index === 0 ? "disabled" : ""}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
          <button type="button" class="rule-action-btn move-down-btn" data-index="${index}" title="下移 (降低优先级)" ${index === urlSwitchRules.length - 1 ? "disabled" : ""}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
        <div class="rule-crud-actions">
          <button type="button" class="rule-action-btn edit-rule-btn" data-index="${index}" title="编辑规则">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            编辑
          </button>
          <button type="button" class="rule-action-btn delete-rule-btn text-danger" data-index="${index}" title="删除规则">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            删除
          </button>
        </div>
      </div>
    `;
    rulesList.appendChild(card);
  });
  
  bindRuleCardEvents();
}

// Bind active toggles, reordering and CRUD event listeners to rules cards
function bindRuleCardEvents() {
  document.querySelectorAll(".rule-toggle-checkbox").forEach(chk => {
    chk.addEventListener("change", async (e) => {
      const idx = parseInt(chk.dataset.index);
      urlSwitchRules[idx].enabled = chk.checked;
      await saveRulesToStorage();
      renderRulesList();
      await evaluateUrlSwitchingForActiveTab();
    });
  });
  
  document.querySelectorAll(".move-up-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const idx = parseInt(btn.dataset.index);
      if (idx > 0) {
        const temp = urlSwitchRules[idx];
        urlSwitchRules[idx] = urlSwitchRules[idx - 1];
        urlSwitchRules[idx - 1] = temp;
        
        await saveRulesToStorage();
        renderRulesList();
        await evaluateUrlSwitchingForActiveTab();
      }
    });
  });
  
  document.querySelectorAll(".move-down-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const idx = parseInt(btn.dataset.index);
      if (idx < urlSwitchRules.length - 1) {
        const temp = urlSwitchRules[idx];
        urlSwitchRules[idx] = urlSwitchRules[idx + 1];
        urlSwitchRules[idx + 1] = temp;
        
        await saveRulesToStorage();
        renderRulesList();
        await evaluateUrlSwitchingForActiveTab();
      }
    });
  });
  
  document.querySelectorAll(".edit-rule-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(btn.dataset.index);
      openRuleEditor(idx);
    });
  });
  
  document.querySelectorAll(".delete-rule-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const idx = parseInt(btn.dataset.index);
      if (confirm(`确定要删除规则 "${urlSwitchRules[idx].name}" 吗？`)) {
        urlSwitchRules.splice(idx, 1);
        await saveRulesToStorage();
        renderRulesList();
        await evaluateUrlSwitchingForActiveTab();
      }
    });
  });

  // Clicking the card body also opens edit mode, so edit is always reachable.
  document.querySelectorAll(".rule-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest("label")) {
        return;
      }
      const idx = parseInt(card.dataset.index || "", 10);
      if (!Number.isNaN(idx)) {
        openRuleEditor(idx);
      }
    });
  });
}

// Persist rules in storage
async function saveRulesToStorage() {
  await chrome.storage.local.set({ urlSwitchRules: urlSwitchRules });
}

// Slide down and populate rule editor panel
function openRuleEditor(index = null) {
  const ruleEditor = document.getElementById("rule-editor");
  const editorTitle = document.getElementById("editor-title");
  const editIndexInput = document.getElementById("edit-rule-index");
  
  const ruleName = document.getElementById("rule-name");
  const rulePattern = document.getElementById("rule-pattern");
  const ruleCwd = document.getElementById("rule-cwd");
  
  if (!ruleEditor) return;
  
  if (index !== null) {
    const rule = urlSwitchRules[index];
    editorTitle.textContent = "编辑规则";
    editIndexInput.value = index;
    
    ruleName.value = rule.name || "";
    rulePattern.value = rule.pattern || "";
    ruleCwd.value = rule.cwd || "";
    
    // Render configured models and select the one matching this rule
    renderConfiguredModelsForRule();
    // Try to find and select the matching model
    const ruleProviderSelect = document.getElementById("rule-provider");
    if (ruleProviderSelect) {
      // Look for a model that matches the saved rule provider/model
      let found = false;
      for (let i = 0; i < ruleProviderSelect.options.length; i++) {
        const opt = ruleProviderSelect.options[i];
        if (opt.dataset.provider === rule.provider && opt.dataset.modelName === rule.model) {
          ruleProviderSelect.selectedIndex = i;
          found = true;
          break;
        }
      }
      // If not found, try to match by just provider
      if (!found) {
        for (let i = 0; i < ruleProviderSelect.options.length; i++) {
          const opt = ruleProviderSelect.options[i];
          if (opt.dataset.provider === rule.provider) {
            ruleProviderSelect.selectedIndex = i;
            break;
          }
        }
      }
    }
    
    toggleRuleCwdGroup(rule.provider);
  } else {
    editorTitle.textContent = "添加规则";
    editIndexInput.value = "";
    
    ruleName.value = "";
    rulePattern.value = "";
    ruleCwd.value = "";
    
    // Render configured models for new rule
    renderConfiguredModelsForRule();
    toggleRuleCwdGroup("gemini");
  }
  
  ruleEditor.classList.remove("hidden");
  ruleEditor.scrollIntoView({ behavior: "smooth", block: "end" });
}

// Render model options for selected provider in rule editor
function renderRuleModelSelection(provider, selectedValue) {
  const ruleModelSelect = document.getElementById("rule-model");
  if (!ruleModelSelect) return;
  
  ruleModelSelect.innerHTML = "";
  
  const predefined = providerModels[provider] || [];
  const added = addedProviderModels[provider] || [];
  const allModels = [...predefined, ...added];
  
  allModels.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.value;
    opt.textContent = m.label;
    if (m.value === selectedValue) opt.selected = true;
    ruleModelSelect.appendChild(opt);
  });
  
  // Custom provider fallback support
  if (provider === "custom") {
    // If selectedValue is not in allModels, add a special option for it
    if (selectedValue && !allModels.some(m => m.value === selectedValue)) {
      const opt = document.createElement("option");
      opt.value = selectedValue;
      opt.textContent = selectedValue;
      opt.selected = true;
      ruleModelSelect.appendChild(opt);
    }
  }
}

// Render configured models list for rule selection (new approach)
function renderConfiguredModelsForRule(selectedModelId = null) {
  const ruleProviderSelect = document.getElementById("rule-provider");
  if (!ruleProviderSelect) return;
  
  ruleProviderSelect.innerHTML = "";
  
  // Add configured API models
  if (configuredApiModels.length > 0) {
    const group = document.createElement("optgroup");
    group.label = "已配置的 API 模型";
    configuredApiModels.forEach(model => {
      const opt = document.createElement("option");
      opt.value = model.id;
      opt.dataset.type = "api";
      opt.dataset.provider = model.provider;
      opt.dataset.modelName = model.model;
      opt.dataset.isAgent = "false";
      opt.textContent = `${model.label} (${model.provider})`;
      if (model.id === selectedModelId) opt.selected = true;
      group.appendChild(opt);
    });
    ruleProviderSelect.appendChild(group);
  }
  
  // Add detected local agents
  if (detectedLocalAgents.length > 0) {
    const group = document.createElement("optgroup");
    group.label = "本地 Agent";
    detectedLocalAgents.forEach(agent => {
      const agentModel = agent.id || "";
      const agentLabel = agent.label || agent.displayName || agent.name || agentModel;
      const opt = document.createElement("option");
      opt.value = agent.id;
      opt.dataset.type = "agent";
      opt.dataset.provider = agent.id; // e.g., "claude-agent"
      opt.dataset.modelName = agentModel;
      opt.dataset.isAgent = "true";
      opt.textContent = agentLabel;
      if (agent.id === selectedModelId) opt.selected = true;
      group.appendChild(opt);
    });
    ruleProviderSelect.appendChild(group);
  }
  
  // If nothing configured, show default providers as fallback
  if (configuredApiModels.length === 0 && detectedLocalAgents.length === 0) {
    const defaults = [
      { label: "Google Gemini 官方 API", value: "gemini:default", provider: "gemini", model: "gemini-2.0-flash" },
      { label: "OpenAI 官方 API", value: "openai:default", provider: "openai", model: "gpt-4" },
      { label: "Anthropic Claude 官方 API", value: "claude:default", provider: "claude", model: "claude-3-5-sonnet-20241022" },
      { label: "Claude Code 本地 Agent", value: "claude-agent:default", provider: "claude-agent", model: "claude-code" },
      { label: "Codex CLI 本地 Agent", value: "codex-agent:default", provider: "codex-agent", model: "codex" },
      { label: "Gemini CLI 本地 Agent", value: "gemini-agent:default", provider: "gemini-agent", model: "gemini" }
    ];
    defaults.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.dataset.provider = item.provider;
      opt.dataset.modelName = item.model;
      opt.dataset.isAgent = item.provider.endsWith("-agent") ? "true" : "false";
      opt.textContent = item.label;
      ruleProviderSelect.appendChild(opt);
    });
  }
}

// Toggle rule editor project CWD field
function toggleRuleCwdGroup(provider) {
  const ruleCwdGroup = document.getElementById("rule-cwd-group");
  if (!ruleCwdGroup) return;
  if (provider.endsWith("-agent")) {
    ruleCwdGroup.classList.remove("hidden");
  } else {
    ruleCwdGroup.classList.add("hidden");
  }
}
