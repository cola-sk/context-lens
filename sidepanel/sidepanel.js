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
    "claude-agent": { apiUrl: "http://localhost:3100", cwd: "", claudePath: "", modelName: "claude-code" }
  }
};

let activeFormProvider = "gemini";

let currentContext = null; // { text, pageUrl, pageTitle }
let chatHistory = []; // Unified messages history [{ role: 'user'|'assistant', content }]
let includeFullPageChecked = false; // cached checkbox state for active tab
let activeReader = null; // Current stream reader to abort if needed
let customModels = []; // Cache of custom models retrieved via /models endpoint
let customManualMode = false; // Tracks if custom model text input is shown

// Tab Isolation Cache
let tabStates = {}; // tabId -> { currentContext, chatHistory, includeFullPageChecked }
let currentTabId = null;

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

// Save active tab's global state to tabStates before switching or modifying
function saveActiveTabState() {
  if (currentTabId) {
    const state = getTabState(currentTabId);
    state.currentContext = currentContext;
    state.chatHistory = [...chatHistory];
    state.includeFullPageChecked = includeFullPageChecked;
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

// Settings Drawer DOM
const settingsToggle = document.getElementById("settings-toggle");
const settingsDrawer = document.getElementById("settings-drawer");
const settingsClose = document.getElementById("settings-close");
const settingsForm = document.getElementById("settings-form");
const apiProvider = document.getElementById("api-provider");
const keyGroup = document.getElementById("key-group");
const apiKeyLabel = document.getElementById("api-key-label");
const apiKey = document.getElementById("api-key");
const toggleKeyVisibility = document.getElementById("toggle-key-visibility");
const urlGroup = document.getElementById("url-group");
const apiUrl = document.getElementById("api-url");
const cwdGroup = document.getElementById("cwd-group");
const apiCwd = document.getElementById("api-cwd");
const claudePathGroup = document.getElementById("claude-path-group");
const claudePath = document.getElementById("claude-path");
const modelSelectGroup = document.getElementById("model-select-group");
const modelLabel = document.getElementById("model-label");
const modelInputContainer = document.getElementById("model-input-container");
const modelTemperature = document.getElementById("model-temperature");
const tempVal = document.getElementById("temp-val");
const settingsStatus = document.getElementById("settings-status");

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
      handleNewSelection(changes.lastSelection.newValue);
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
    handleNewSelection(sessionData.lastSelection);
  } else {
    rebuildUIForActiveTab();
  }
});

// Load settings from chrome.storage.local
async function loadSettings() {
  const result = await chrome.storage.local.get(["apiProvider", "apiKey", "apiUrl", "modelName", "temperature", "customModels", "cwd", "claudePath", "providers"]);
  
  appSettings.apiProvider = result.apiProvider || "gemini";
  appSettings.temperature = result.temperature !== undefined ? parseFloat(result.temperature) : 0.7;

  // Set up providers config cache with robust fallback defaults
  const defaultProviders = {
    gemini: { apiKey: "", modelName: "gemini-2.5-flash" },
    openai: { apiKey: "", modelName: "gpt-4o-mini" },
    claude: { apiKey: "", modelName: "claude-3-5-sonnet-latest" },
    custom: { apiKey: "", apiUrl: "", modelName: "" },
    "claude-agent": { apiUrl: "http://localhost:3100", cwd: "", claudePath: "", modelName: "claude-code" }
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

  // Load custom models cache
  customModels = result.customModels || [];
  customManualMode = false; // Reset toggle on load

  // Active form provider starts as saved apiProvider
  activeFormProvider = appSettings.apiProvider;

  // Apply settings to form fields based on active provider
  apiProvider.value = appSettings.apiProvider;
  
  const currentProvConfig = appSettings.providers[activeFormProvider] || {};
  apiKey.value = currentProvConfig.apiKey || "";
  apiUrl.value = currentProvConfig.apiUrl || "";
  modelTemperature.value = appSettings.temperature;
  tempVal.textContent = appSettings.temperature;
  if (apiCwd) apiCwd.value = currentProvConfig.cwd || "";
  if (claudePath) claudePath.value = currentProvConfig.claudePath || "";

  // Set root values for backwards compatibility and easy lookup in triggerAIStreamResponse
  appSettings.apiKey = currentProvConfig.apiKey || "";
  appSettings.apiUrl = currentProvConfig.apiUrl || "";
  appSettings.modelName = currentProvConfig.modelName || "";
  appSettings.cwd = currentProvConfig.cwd || "";
  appSettings.claudePath = currentProvConfig.claudePath || "";

  renderModelSelection(appSettings.apiProvider, appSettings.modelName);
  toggleProviderFields(appSettings.apiProvider);
}

// Sync current settings form fields into active provider's memory cache
function syncFormToProviderCache(provider) {
  if (!appSettings.providers) return;
  if (!appSettings.providers[provider]) {
    appSettings.providers[provider] = {};
  }
  
  appSettings.providers[provider].apiKey = apiKey.value.trim();
  appSettings.providers[provider].apiUrl = apiUrl.value.trim();
  if (apiCwd) appSettings.providers[provider].cwd = apiCwd.value.trim();
  if (claudePath) appSettings.providers[provider].claudePath = claudePath.value.trim();
  
  const modelEl = document.getElementById("api-model");
  if (modelEl) {
    appSettings.providers[provider].modelName = modelEl.value.trim();
  }
}

function loadProviderCacheToForm(provider) {
  if (!appSettings.providers) return;
  
  const defaultProviders = {
    gemini: { apiKey: "", modelName: "gemini-2.5-flash" },
    openai: { apiKey: "", modelName: "gpt-4o-mini" },
    claude: { apiKey: "", modelName: "claude-3-5-sonnet-latest" },
    custom: { apiKey: "", apiUrl: "", modelName: "" },
    "claude-agent": { apiUrl: "http://localhost:3100", cwd: "", claudePath: "", modelName: "claude-code" }
  };
  
  if (!appSettings.providers[provider]) {
    appSettings.providers[provider] = { ...(defaultProviders[provider] || {}) };
  }
  
  const currentProvConfig = appSettings.providers[provider];
  apiKey.value = currentProvConfig.apiKey || "";
  apiUrl.value = currentProvConfig.apiUrl || "";
  if (apiCwd) apiCwd.value = currentProvConfig.cwd || "";
  if (claudePath) claudePath.value = currentProvConfig.claudePath || "";
  
  toggleProviderFields(provider);
  renderModelSelection(provider, currentProvConfig.modelName || "");
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

  // Provider change in form
  apiProvider.addEventListener("change", (e) => {
    const newProvider = e.target.value;
    
    // 1. Sync current form inputs to last active provider cache
    syncFormToProviderCache(activeFormProvider);
    
    // 2. Update activeFormProvider index
    activeFormProvider = newProvider;
    
    // 3. Load next provider's inputs from cache and render fields
    loadProviderCacheToForm(newProvider);
  });

  // Temp slider
  modelTemperature.addEventListener("input", (e) => {
    tempVal.textContent = e.target.value;
  });

  // Toggle API Key visibility
  toggleKeyVisibility.addEventListener("click", () => {
    const type = apiKey.getAttribute("type") === "password" ? "text" : "password";
    apiKey.setAttribute("type", type);
    // Toggle SVG icon paths depending on visibility
    toggleKeyVisibility.innerHTML = type === "password" ? 
      `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>` : 
      `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>`;
  });

  // Settings Save Submit
  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const provider = apiProvider.value;
    
    // Sync current inputs of the active provider to cache first
    syncFormToProviderCache(provider);
    
    const currentProvConfig = appSettings.providers[provider] || {};
    const key = currentProvConfig.apiKey || "";
    const url = currentProvConfig.apiUrl || "";
    const model = currentProvConfig.modelName || "";
    const temp = parseFloat(modelTemperature.value);

    // Validate inputs
    if (provider !== "custom" && provider !== "claude-agent" && !key) {
      showSettingsStatus("官方供应商必须填写 API 密钥。", "error");
      return;
    }
    if (provider === "custom" && !url) {
      showSettingsStatus("自定义 API 必须填写端点基准地址 (URL)。", "error");
      return;
    }
    if (provider === "claude-agent" && !url) {
      showSettingsStatus("Claude Agent 必须填写 Bridge 服务基准地址。", "error");
      return;
    }
    if (!model) {
      showSettingsStatus("必须选择或填写模型标识符。", "error");
      return;
    }

    // Save active provider and temperature
    appSettings.apiProvider = provider;
    appSettings.temperature = temp;
    
    // Set root fields for backwards compatibility and easy lookup in triggerAIStreamResponse
    appSettings.apiKey = key;
    appSettings.apiUrl = url;
    appSettings.modelName = model;
    appSettings.cwd = currentProvConfig.cwd || "";
    appSettings.claudePath = currentProvConfig.claudePath || "";
    
    await chrome.storage.local.set(appSettings);
    showSettingsStatus("设置已成功保存！", "success");
    updateStatusUI();
    
    setTimeout(() => {
      toggleDrawer(false);
    }, 800);
  });

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
  });
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

// Toggle specific fields dynamically based on provider choice
function toggleProviderFields(provider) {
  const apiUrlLabel = document.getElementById("api-url-label");
  const apiUrlTip = document.getElementById("api-url-tip");

  if (provider === "custom") {
    urlGroup.classList.remove("hidden");
    keyGroup.classList.remove("hidden"); // Show API key for custom endpoints
    apiKeyLabel.textContent = "API 密钥 (本地可选)";
    apiKey.placeholder = "sk-...";
    keyGroup.querySelector("input").required = false;
    
    cwdGroup.classList.add("hidden");
    claudePathGroup.classList.add("hidden");
    
    if (apiUrlLabel) apiUrlLabel.textContent = "自定义 API 基准地址 (Base URL)";
    if (apiUrlTip) apiUrlTip.textContent = "兼容 OpenAI 规范的本地或第三方服务基准 URL (例如 Ollama, LM Studio, vLLM 等)";
  } else if (provider === "claude-agent") {
    urlGroup.classList.remove("hidden");
    keyGroup.classList.add("hidden"); // Hide API Key for local bridge
    keyGroup.querySelector("input").required = false;
    
    cwdGroup.classList.remove("hidden");
    claudePathGroup.classList.remove("hidden");
    
    if (apiUrlLabel) apiUrlLabel.textContent = "Node Bridge 基准地址";
    if (apiUrlTip) apiUrlTip.textContent = "本地 Claude Code Bridge 服务的 HTTP 基准地址，通常为 http://localhost:3100";
    if (!apiUrl.value || apiUrl.value === "http://localhost:3001") apiUrl.value = "http://localhost:3100"; // Auto fill default port
  } else {
    urlGroup.classList.add("hidden");
    keyGroup.classList.remove("hidden");
    keyGroup.querySelector("input").required = true;
    
    cwdGroup.classList.add("hidden");
    claudePathGroup.classList.add("hidden");
    
    if (provider === "gemini") {
      apiKeyLabel.textContent = "Gemini API 密钥";
      apiKey.placeholder = "AIzaSy...";
    } else if (provider === "openai") {
      apiKeyLabel.textContent = "OpenAI API 密钥";
      apiKey.placeholder = "sk-proj-...";
    } else if (provider === "claude") {
      apiKeyLabel.textContent = "Claude API 密钥";
      apiKey.placeholder = "sk-ant-...";
    }
  }
}

// Render dynamic HTML inside model select block (drop down or custom text input)
function renderModelSelection(provider, selectedValue) {
  modelInputContainer.innerHTML = "";

  if (provider === "custom") {
    modelLabel.textContent = "模型标识符 (Model)";
    
    // Create flex wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "model-custom-wrapper";
    
    // Determine manual mode based on current data
    if (customModels.length === 0) {
      customManualMode = true;
    } else if (selectedValue && !customModels.includes(selectedValue) && selectedValue !== "__manual__") {
      customManualMode = true;
    }
    
    let mainInputEl;
    let listToggleEl = null;
    
    if (customManualMode) {
      // Manual text input
      const input = document.createElement("input");
      input.type = "text";
      input.id = "api-model";
      input.placeholder = "例如 llama3, qwen2.5:7b, qwen2";
      input.value = selectedValue || "";
      mainInputEl = input;
      
      // If customModels is not empty, show "List" toggle button to return to select list
      if (customModels.length > 0) {
        listToggleEl = document.createElement("button");
        listToggleEl.type = "button";
        listToggleEl.className = "toggle-mode-btn";
        listToggleEl.title = "从已同步的模型列表中选择";
        listToggleEl.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <circle cx="3" cy="6" r="1" fill="currentColor"></circle>
            <circle cx="3" cy="12" r="1" fill="currentColor"></circle>
            <circle cx="3" cy="18" r="1" fill="currentColor"></circle>
          </svg>
          <span>列表</span>
        `;
        listToggleEl.addEventListener("click", () => {
          customManualMode = false;
          renderModelSelection("custom", customModels[0]);
        });
      }
    } else {
      // Dropdown selection list
      const select = document.createElement("select");
      select.id = "api-model";
      
      customModels.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (m === selectedValue) opt.selected = true;
        select.appendChild(opt);
      });
      
      // Add manual option at the end
      const optManual = document.createElement("option");
      optManual.value = "__manual__";
      optManual.textContent = "✍️ 手动输入...";
      if (selectedValue === "__manual__") optManual.selected = true;
      select.appendChild(optManual);
      
      select.addEventListener("change", (e) => {
        if (e.target.value === "__manual__") {
          customManualMode = true;
          renderModelSelection("custom", "");
        }
      });
      
      mainInputEl = select;
    }
    
    // Add main input element to wrapper
    wrapper.appendChild(mainInputEl);
    
    // Add list return toggle button if available
    if (listToggleEl) {
      wrapper.appendChild(listToggleEl);
    }
    
    // Add Sync/Fetch button
    const syncBtn = document.createElement("button");
    syncBtn.type = "button";
    syncBtn.id = "fetch-custom-models-btn";
    syncBtn.className = "sync-btn";
    syncBtn.title = "从自定义 API 端点同步可用模型列表";
    syncBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
      <span>同步</span>
    `;
    
    syncBtn.addEventListener("click", handleFetchCustomModels);
    
    wrapper.appendChild(syncBtn);
    modelInputContainer.appendChild(wrapper);
  } else {
    modelLabel.textContent = "模型标识符 (Model)";
    // Create select dropdown
    const select = document.createElement("select");
    select.id = "api-model";
    
    const models = providerModels[provider] || [];
    models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.value;
      opt.textContent = m.label;
      if (m.value === selectedValue) opt.selected = true;
      select.appendChild(opt);
    });

    modelInputContainer.appendChild(select);
  }
}

// Fetch custom models from OpenAI-compatible or Ollama endpoints
async function handleFetchCustomModels() {
  const syncBtn = document.getElementById("fetch-custom-models-btn");
  const urlVal = apiUrl.value.trim();
  const keyVal = apiKey.value.trim();
  
  if (!urlVal) {
    showSettingsStatus("请先输入您的自定义 API 基准地址 (Base URL)。", "error");
    return;
  }
  
  // Set loading state
  if (syncBtn) {
    syncBtn.classList.add("loading");
    syncBtn.disabled = true;
    syncBtn.querySelector("span").textContent = "正在同步...";
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
    syncBtn.querySelector("span").textContent = "同步";
  }
  
  if (success && fetchedList.length > 0) {
    customModels = fetchedList;
    customManualMode = false;
    
    // Save cache immediately to storage
    await chrome.storage.local.set({ customModels: customModels });
    
    // Select existing model name if matched, else fallback to first fetched model
    const currentModelEl = document.getElementById("api-model");
    let modelToSelect = fetchedList[0];
    if (currentModelEl && fetchedList.includes(currentModelEl.value)) {
      modelToSelect = currentModelEl.value;
    } else if (appSettings.modelName && fetchedList.includes(appSettings.modelName)) {
      modelToSelect = appSettings.modelName;
    }
    
    renderModelSelection("custom", modelToSelect);
    showSettingsStatus(`成功同步了 ${fetchedList.length} 个模型！`, "success");
  } else {
    showSettingsStatus(`同步失败：${lastError}`, "error");
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

// Update connection status pill at the bottom
function updateStatusUI() {
  const hasKey = appSettings.apiKey || appSettings.apiProvider === "custom" || appSettings.apiProvider === "claude-agent";
  
  if (hasKey && appSettings.modelName) {
    connectionStatusPill.className = "status-pill online";
    
    let displayName = appSettings.modelName;
    if (appSettings.apiProvider === "custom") {
      displayName = `自定义: ${appSettings.modelName}`;
    } else if (appSettings.apiProvider === "claude-agent") {
      displayName = `本地 Agent: ${appSettings.modelName}`;
    }
    connectedModelName.textContent = displayName;
    
    chatInput.disabled = false;
    chatInput.placeholder = "针对所选上下文进行提问... (Ctrl + Enter 发送)";
    sendBtn.disabled = false;
  } else {
    connectionStatusPill.className = "status-pill offline";
    connectedModelName.textContent = "未配置 API 连接";
    
    chatInput.disabled = true;
    chatInput.placeholder = "请先配置并保存 AI 服务端设置...";
    sendBtn.disabled = true;
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
      msgEl.innerHTML = `
        <span class="message-sender">${isUser ? "您" : "Lens"}</span>
        <div class="message-bubble">${formatMarkdown(msg.content)}</div>
      `;
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
async function handleNewSelection(selection) {
  if (!selection) return;

  const tabId = selection.tabId || currentTabId;
  if (!tabId) return;

  saveActiveTabState();

  const state = getTabState(tabId);
  if (selection.text) {
    state.currentContext = selection;
    state.includeFullPageChecked = false; // Reset to unchecked for safety
  }

  if (tabId === currentTabId) {
    restoreActiveTabState(currentTabId);
    rebuildUIForActiveTab();
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
  }

  // Send request to AI
  let fullPrompt = text;
  
  // If we have selected text context, prepend/attach it
  if (currentContext && chatHistory.length === 1) {
    const cd = currentContext.contextData;
    if (cd) {
      if (appSettings.apiProvider === "claude-agent") {
        // Specialized agentic instructions for codebase edits
        fullPrompt = `You are a local agentic coding assistant running directly in the user's project CWD workspace folder: ${appSettings.cwd || "current folder"}.
The user is viewing a web page and selected a specific element/text. Your goal is to search the local CWD codebase to locate the file defining this UI element/text, and modify it in place according to their instructions.

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

        // Append simplified full-page context if checkbox is checked
        const includeFullPageToggle = document.getElementById("include-full-page-context");
        if (includeFullPageToggle && includeFullPageToggle.checked && cd.fullPageSimplifiedText) {
          fullPrompt += `\n[Full Page Simplified Context]\nBelow is a token-efficient, simplified extraction of the main body of this webpage:\n"""\n${cd.fullPageSimplifiedText}\n"""\n`;
        }

        fullPrompt += `
[User Prompt / Instructions]
${text}

[Goal & Execution Steps]
1. Search the CWD codebase using tools like grep, find, or search to find the source file (React/Vue components, HTML, JS, TS, CSS, JSON, or template files) that contains the selected UI text "${cd.selectedText}" or matches this surrounding context.
2. Edit the file directly in the local CWD codebase to perform the user's instructions: "${text}".
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

        // Append simplified full-page context if checkbox is checked
        const includeFullPageToggle = document.getElementById("include-full-page-context");
        if (includeFullPageToggle && includeFullPageToggle.checked && cd.fullPageSimplifiedText) {
          fullPrompt += `\n[Full Page Simplified Context]\nBelow is a token-efficient, simplified extraction of the main body of this webpage:\n"""\n${cd.fullPageSimplifiedText}\n"""\n`;
        }

        fullPrompt += `\n[User Prompt / Instructions]\n${text}`;
      }
    } else {
      // Basic context fallback
      if (appSettings.apiProvider === "claude-agent") {
        fullPrompt = `You are a local agentic coding assistant running directly in the user's project CWD workspace folder: ${appSettings.cwd || "current folder"}.
The user is viewing a web page and selected a specific element/text. Your goal is to search the CWD codebase to locate the file defining this UI element/text, and modify it in place according to their instructions.

Page Title: ${currentContext.pageTitle}
Page URL: ${currentContext.pageUrl}
Selected Snippet: "${currentContext.text}"

[User Prompt / Instructions]
${text}

[Goal & Execution Steps]
1. Search the CWD codebase using tools like grep, find, or search to find the source file (React/Vue components, HTML, JS, TS, CSS, JSON, or template files) containing the selected UI text "${currentContext.text}".
2. Edit the file directly in the local CWD codebase to perform the user's instructions: "${text}".
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
      chatHistory[0].content = fullPrompt;
      chatHistory[0]._contextEmbedded = true; // mark as having context already embedded
      if (messageTabId) {
        const state = getTabState(messageTabId);
        state.chatHistory = [...chatHistory];
      }
    }
  }

  await triggerAIStreamResponse(fullPrompt, messageTabId);
}

// Append a bubble element to the chat stream
function appendMessage(role, text) {
  const isUser = role === "user";
  const msgEl = document.createElement("div");
  msgEl.className = `message ${role}`;
  
  // Format HTML from markdown (simple custom rendering for speed/safety)
  const formattedHTML = formatMarkdown(text);

  msgEl.innerHTML = `
    <span class="message-sender">${isUser ? "您" : "Lens"}</span>
    <div class="message-bubble">${formattedHTML}</div>
  `;

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
async function triggerAIStreamResponse(promptText, messageTabId) {
  const targetTabId = messageTabId || currentTabId;

  // If a reader is active, abort it
  if (activeReader) {
    try {
      await activeReader.cancel();
    } catch(e) {}
    activeReader = null;
  }

  // Check configs
  if (!appSettings.apiKey && appSettings.apiProvider !== "custom" && appSettings.apiProvider !== "claude-agent") {
    appendMessage("assistant", "⚠️ ContextLens 尚未完成配置。请点击右上角打开 AI 服务端配置面板，填写您的 API 密钥并保存！");
    return;
  }

  // Append temporary loading placeholder assistant bubble if targetTabId is active
  const assistantBubble = document.createElement("div");
  assistantBubble.className = "message assistant";
  assistantBubble.innerHTML = `
    <span class="message-sender">Lens</span>
    <div class="message-bubble">
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

  // Register the stream bubble immediately in the target tab's history
  const targetState = getTabState(targetTabId);
  const assistantMsgObj = { role: "assistant", content: "" };
  targetState.chatHistory.push(assistantMsgObj);
  if (targetTabId === currentTabId) {
    chatHistory = [...targetState.chatHistory];
  }

  try {
    const { apiProvider, apiKey, apiUrl, modelName, temperature } = appSettings;
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
                  activeBubble.innerHTML = formatMarkdown(streamedText);
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
        messages.push({ role: chatHistory[i].role, content: chatHistory[i].content });
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
            if (contentChunk) {
              streamedText += contentChunk;
              assistantMsgObj.content = streamedText;
              if (targetTabId === currentTabId) {
                let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                if (!activeBubble) activeBubble = bubbleContent;
                if (activeBubble) {
                  activeBubble.innerHTML = formatMarkdown(streamedText);
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
                    activeBubble.innerHTML = formatMarkdown(streamedText);
                  }
                  scrollToBottom();
                }
              }
            } catch(e) {}
          }
        }
      }
    } else if (apiProvider === "claude-agent") {
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
          cwd: appSettings.cwd || "",
          claudePath: appSettings.claudePath || ""
        })
      });

      if (!response.ok) {
        const errObj = await response.json().catch(() => ({}));
        throw new Error(errObj.error || `本地 Bridge 返回错误: ${response.status}`);
      }

      reader = response.body.getReader();
      activeReader = reader;
      const decoder = new TextDecoder();

      if (targetTabId === currentTabId && bubbleContent) {
        bubbleContent.innerHTML = `
          <div class="agent-markdown-content"></div>
          <div class="agent-progress hidden" style="margin-top: 8px; padding: 6px 10px; background: rgba(99, 102, 241, 0.04); border-left: 2px solid #6366f1; font-family: monospace; font-size: 11px; border-radius: 0 4px 4px 0;">
            <div class="agent-status-header" style="font-weight: bold; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; color: var(--accent-indigo);">
              <svg class="spinning-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              本地 Agent 运行中...
            </div>
            <div class="agent-log-content" style="white-space: pre-wrap; max-height: 120px; overflow-y: auto; color: var(--text-secondary);"></div>
          </div>
        `;
      }

      let buffer = "";
      let systemLogsText = "";

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
              if (targetTabId === currentTabId) {
                let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                if (!activeBubble) activeBubble = bubbleContent;
                if (activeBubble) {
                  const headerEl = activeBubble.querySelector(".agent-status-header");
                  if (headerEl) {
                    headerEl.innerHTML = `
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      本地 Agent 运行完毕
                    `;
                    headerEl.style.color = "#10b981";
                  }
                  const progressBox = activeBubble.querySelector(".agent-progress");
                  if (progressBox) {
                    progressBox.style.borderLeftColor = "#10b981";
                    progressBox.style.background = "rgba(16, 185, 129, 0.04)";
                  }
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
                    const markdownEl = activeBubble.querySelector(".agent-markdown-content");
                    if (markdownEl) {
                      markdownEl.innerHTML = formatMarkdown(streamedText);
                    }
                  }
                  scrollToBottom();
                }
              } else if (parsed.type === "system" && parsed.text) {
                systemLogsText += parsed.text;
                
                if (targetTabId === currentTabId) {
                  let activeBubble = messagesList.querySelector(".message.assistant:last-child .message-bubble");
                  if (!activeBubble) activeBubble = bubbleContent;
                  if (activeBubble) {
                    const progressBox = activeBubble.querySelector(".agent-progress");
                    const logContent = activeBubble.querySelector(".agent-log-content");
                    if (progressBox && logContent) {
                      progressBox.classList.remove("hidden");
                      logContent.textContent = systemLogsText;
                      logContent.scrollTop = logContent.scrollHeight;
                    }
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
                    const markdownEl = activeBubble.querySelector(".agent-markdown-content");
                    if (markdownEl) {
                      markdownEl.innerHTML = formatMarkdown(streamedText);
                    }
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
        
        if (appSettings.apiProvider === "claude-agent") {
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

// --- UTILITY MARKDOWN PARSER ---

// Safe, lightweight markdown to HTML compiler
function formatMarkdown(text) {
  if (!text) return "";

  // Escape HTML tags to prevent XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 1. Triple-backtick Code blocks: ```js ... ```
  // Find pairs of ``` and wrap in pre/code blocks
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  html = html.replace(codeBlockRegex, (match, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
  });

  // 2. Inline code: `code`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 3. Bold text: **bold**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // 4. Bullet lists: lines starting with "- " or "* "
  const lines = html.split("\n");
  let inList = false;
  const processedLines = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        processedLines.push('<ul style="margin: 6px 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px;">');
        inList = true;
      }
      processedLines.push(`<li>${trimmed.substring(2)}</li>`);
    } else {
      if (inList) {
        processedLines.push("</ul>");
        inList = false;
      }
      processedLines.push(line);
    }
  }
  if (inList) {
    processedLines.push("</ul>");
  }

  html = processedLines.join("\n");

  // 5. Normal newlines to <br> (only outside pre blocks)
  // Simple check: split by `<pre>` and only process paragraphs
  const parts = html.split(/(<pre>[\s\S]*?<\/pre>)/);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].startsWith("<pre>")) {
      parts[i] = parts[i].replace(/\n/g, "<br>");
    }
  }
  
  return parts.join("");
}
