// Background Service Worker for ContextLens

// Track which tabs have side panel active
let activeSidePanelTabs = new Set();
const SIDE_PANEL_PATH = "sidepanel/sidepanel.html";

// Cache of the latest right-clicked context per tab
let tabRightClickContexts = {};

const LOCAL_AGENT_LABELS = {
  zh: {
    "claude-agent": "Claude Code 本地 Agent",
    "codex-agent": "Codex CLI 本地 Agent",
    "gemini-agent": "Gemini CLI 本地 Agent"
  },
  en: {
    "claude-agent": "Claude Code Local Agent",
    "codex-agent": "Codex CLI Local Agent",
    "gemini-agent": "Gemini CLI Local Agent"
  }
};

const DEFAULT_MODEL_LABELS = {
  zh: "默认模型",
  en: "Default Model"
};

function createContextMenuSafe(options) {
  chrome.contextMenus.create(options, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      console.warn(`🔮 [ContextLens Background] Suppressed contextMenus.create error for ID "${options.id}":`, err.message);
    }
  });
}

let isRebuilding = false;
let hasPendingRebuild = false;

async function rebuildContextMenus() {
  if (isRebuilding) {
    hasPendingRebuild = true;
    return;
  }
  isRebuilding = true;

  try {
    do {
      hasPendingRebuild = false;

      try {
        await chrome.contextMenus.removeAll();
      } catch (err) {
        console.warn("🔮 [ContextLens Background] Failed to clear context menus:", err);
      }

      const result = await chrome.storage.local.get(["contextMenuModelIds", "configuredApiModels", "uiLanguage"]);
      const contextMenuModelIds = result.contextMenuModelIds || [];
      const configuredApiModels = result.configuredApiModels || [];
      const uiLang = result.uiLanguage === "en" ? "en" : "zh";

      // If a new rebuild request arrived while we were waiting for storage,
      // restart the loop directly without registering obsolete menu items.
      if (hasPendingRebuild) {
        continue;
      }

      if (contextMenuModelIds.length === 0) {
        createContextMenuSafe({
          id: "ask-contextlens",
          title: "Ask ContextLens",
          contexts: ["all"]
        });
        console.log("🔮 [ContextLens Background] Registered single top-level context menu.");
      } else {
        createContextMenuSafe({
          id: "ask-contextlens-parent",
          title: "Ask ContextLens",
          contexts: ["all"]
        });

        const defaultLabel = DEFAULT_MODEL_LABELS[uiLang] || "Default Model";
        createContextMenuSafe({
          id: "ask-contextlens-default",
          parentId: "ask-contextlens-parent",
          title: defaultLabel,
          contexts: ["all"]
        });

        for (const modelId of contextMenuModelIds) {
          let label = modelId;
          const localLabels = LOCAL_AGENT_LABELS[uiLang] || LOCAL_AGENT_LABELS.zh;
          if (localLabels[modelId]) {
            label = localLabels[modelId];
          } else {
            const apiModel = configuredApiModels.find(m => m.id === modelId);
            if (apiModel) {
              label = apiModel.label || apiModel.provider || modelId;
            }
          }

          createContextMenuSafe({
            id: `ask-contextlens-model-${modelId}`,
            parentId: "ask-contextlens-parent",
            title: label,
            contexts: ["all"]
          });
        }

        console.log(`🔮 [ContextLens Background] Registered context menu tree with ${contextMenuModelIds.length} pinned models.`);
      }
    } while (hasPendingRebuild);
  } finally {
    isRebuilding = false;
  }
}

// Initialize context menus at startup
rebuildContextMenus();

// Rebuild context menus on storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.contextMenuModelIds || changes.configuredApiModels || changes.uiLanguage)) {
    rebuildContextMenus();
  }
});

function enableSidePanelForTab(tabId, { silent = false } = {}) {
  if (!tabId) return Promise.resolve();
  activeSidePanelTabs.add(tabId);
  return chrome.sidePanel.setOptions({
    tabId,
    path: SIDE_PANEL_PATH,
    enabled: true
  }).catch((err) => {
    if (!silent) {
      console.warn(`🔮 [ContextLens Background] Failed to enable side panel for tab ${tabId}:`, err);
    }
  });
}

async function resolveTabMeta(tabId, fallbackUrl = "", fallbackTitle = "") {
  let url = fallbackUrl || "";
  let title = fallbackTitle || "";
  if (!tabId) return { url, title };

  if (url && title) return { url, title };

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!url) url = tab?.url || "";
    if (!title) title = tab?.title || "";
  } catch (err) {
    // Ignore resolution failures and keep fallback values.
  }
  return { url, title };
}

function buildFallbackContextFromMenuInfo(info, tab) {
  const fallbackText = (
    info.selectionText ||
    info.linkUrl ||
    info.srcUrl ||
    tab?.title ||
    info.pageUrl ||
    tab?.url ||
    ""
  ).trim();
  if (!fallbackText) return null;

  return {
    selectedText: fallbackText,
    contentType: "text",
    surroundingBefore: "",
    surroundingAfter: "",
    parentHeading: "",
    semanticPath: "",
    pageDescription: "",
    fullPageSimplifiedText: "",
    pageUrl: info.pageUrl || tab?.url || "",
    frameUrl: info.frameUrl || "",
    source: "context-menu-fallback"
  };
}

// Disable side panel globally by default on background script startup
chrome.sidePanel.setOptions({
  enabled: false
}).catch((err) => {
  console.warn("🔮 [ContextLens Background] Failed to disable side panel globally on startup:", err);
});

// Create Context Menu on install and disable side panel globally by default
chrome.runtime.onInstalled.addListener(() => {
  rebuildContextMenus();

  // Disable side panel globally by default
  chrome.sidePanel.setOptions({
    enabled: false
  });
});

// Handle toolbar action clicks (extension icon)
chrome.action.onClicked.addListener((tab) => {
  enableSidePanelForTab(tab.id);
  
  // Open the side panel synchronously to preserve user gesture
  chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
    console.error("🔮 [ContextLens Background] Failed to open side panel on icon click:", err);
  });

  // Set a baseline empty selection payload asynchronously
  chrome.storage.session.set({
    lastSelection: {
      tabId: tab.id,
      text: "",
      pageUrl: tab.url,
      pageTitle: tab.title,
      timestamp: Date.now(),
      contextData: null
    }
  });
});

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const isTargetMenu = info.menuItemId === "ask-contextlens" || 
                       info.menuItemId === "ask-contextlens-default" || 
                       info.menuItemId.startsWith("ask-contextlens-model-");
                       
  if (isTargetMenu) {
    enableSidePanelForTab(tab.id);

    // 1. Open the side panel synchronously for the active tab (preserves gesture)
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
      console.error("🔮 [ContextLens Background] Failed to open side panel on context menu click:", err);
    });

    let selectionPayload = {
      tabId: tab.id,
      text: info.selectionText || "",
      pageUrl: tab?.url || info.pageUrl || "",
      pageTitle: tab?.title || "",
      timestamp: Date.now(),
      contextData: null
    };

    if (info.menuItemId.startsWith("ask-contextlens-model-")) {
      const modelId = info.menuItemId.replace("ask-contextlens-model-", "");
      selectionPayload.temporaryModelOverride = modelId;
    } else if (info.menuItemId === "ask-contextlens-default") {
      selectionPayload.temporaryModelOverride = "";
    }

    // 2. Query cache first, and fall back to content script message querying if cache is missing or stale
    (async () => {
      const cached = tabRightClickContexts[tab.id];
      const isCacheFresh = cached && (Date.now() - cached.timestamp < 5000); // 5 seconds threshold

      if (isCacheFresh) {
        console.log("🔮 [ContextLens Background] Using fresh cached right-click context!");
        selectionPayload.contextData = cached.contextData;
        if (!selectionPayload.text && cached.text) {
          selectionPayload.text = cached.text;
        }
      } else {
        let resolvedResponse = null;
        
        // 1. Try to send message to the specific frame clicked
        try {
          const response = await chrome.tabs.sendMessage(
            tab.id, 
            { type: "GET_RICH_CONTEXT" }, 
            { frameId: info.frameId }
          );
          if (response && response.success && response.contextData) {
            resolvedResponse = response;
            console.log(`🔮 [ContextLens Background] Successfully retrieved rich DOM context from frame ${info.frameId}!`);
          }
        } catch (err) {
          console.log(`🔮 [ContextLens Background] Specific frame ${info.frameId} failed:`, err.message);
        }

        // 2. If specific frame failed and it was a sub-frame, try main frame (frameId: 0) as fallback
        if (!resolvedResponse && info.frameId !== 0) {
          try {
            console.log("🔮 [ContextLens Background] Trying main frame (frameId: 0) fallback...");
            const response = await chrome.tabs.sendMessage(
              tab.id, 
              { type: "GET_RICH_CONTEXT" }, 
              { frameId: 0 }
            );
            if (response && response.success && response.contextData) {
              resolvedResponse = response;
              console.log("🔮 [ContextLens Background] Successfully recovered context from main frame!");
            }
          } catch (err) {
            console.log("🔮 [ContextLens Background] Main frame fallback also failed:", err.message);
          }
        }

        // 3. Self-heal/Inject if both failed due to content script missing
        if (!resolvedResponse) {
          const targetFrameId = info.frameId || 0;
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [targetFrameId] },
              files: ["content.js"]
            });
            await chrome.scripting.insertCSS({
              target: { tabId: tab.id, frameIds: [targetFrameId] },
              files: ["content.css"]
            });
            console.log(`🔮 [ContextLens Background] Dynamically self-healed and injected content script into frame ${targetFrameId}!`);

            // Retry after injection
            try {
              const response = await chrome.tabs.sendMessage(
                tab.id,
                { type: "GET_RICH_CONTEXT" },
                { frameId: targetFrameId }
              );
              if (response && response.success && response.contextData) {
                resolvedResponse = response;
              }
            } catch (retryErr) {
              console.log("🔮 [ContextLens Background] Retry after injection failed:", retryErr.message);
            }
          } catch (injectErr) {
            console.warn("🔮 [ContextLens Background] Self-healing injection failed:", injectErr.message || injectErr);
          }
        }

        // 4. Assign compiled context or fall back to context menu fallback
        if (resolvedResponse) {
          selectionPayload.contextData = resolvedResponse.contextData;
          if (!selectionPayload.text && resolvedResponse.contextData.selectedText) {
            selectionPayload.text = resolvedResponse.contextData.selectedText;
          }
        } else {
          const fallbackContext = buildFallbackContextFromMenuInfo(info, tab);
          if (fallbackContext) {
            selectionPayload.contextData = fallbackContext;
            if (!selectionPayload.text) {
              selectionPayload.text = fallbackContext.selectedText;
            }
            console.log("🔮 [ContextLens Background] Using context-menu fallback context.");
          }
        }
      }

      // Ensure page URL/title are always available for sidepanel rendering and prompt context.
      if (!selectionPayload.pageUrl && selectionPayload.contextData?.pageUrl) {
        selectionPayload.pageUrl = selectionPayload.contextData.pageUrl;
      }
      if (!selectionPayload.pageTitle && selectionPayload.contextData?.pageTitle) {
        selectionPayload.pageTitle = selectionPayload.contextData.pageTitle;
      }

      const resolvedMeta = await resolveTabMeta(
        tab.id,
        selectionPayload.pageUrl,
        selectionPayload.pageTitle
      );
      selectionPayload.pageUrl = resolvedMeta.url || selectionPayload.pageUrl || "";
      selectionPayload.pageTitle = resolvedMeta.title || selectionPayload.pageTitle || "";

      // 3. Save selection details to session storage (notifies side panel)
      await chrome.storage.session.set({
        lastSelection: selectionPayload
      });
    })();
  }
});

// Handle messages from content script (Floating Action Button click or right click caching)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RIGHT_CLICK_CONTEXT") {
    const tabId = sender.tab?.id;
    if (tabId) {
      tabRightClickContexts[tabId] = {
        contextData: message.contextData,
        text: message.text,
        isSelection: message.isSelection,
        timestamp: Date.now()
      };
      console.log(`🔮 [ContextLens Background] Cached right-click context for tab ${tabId}. IsSelection: ${message.isSelection}`);
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "OPEN_SIDE_PANEL") {
    enableSidePanelForTab(sender.tab.id);

    // 1. Open side panel for the tab synchronously (preserves gesture context across message boundaries)
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch((err) => {
      console.error("🔮 [ContextLens Background] Failed to open side panel from content script message:", err);
    });

    // 2. Save selection context with rich payload to session storage and reply asynchronously
    (async () => {
      try {
        const fallbackUrl = sender.tab?.url || message?.contextData?.pageUrl || "";
        const fallbackTitle = sender.tab?.title || message?.contextData?.pageTitle || "";
        if (!sender.tab?.url && fallbackUrl) {
          console.log("🔮 [ContextLens Background] sender.tab.url is empty. Using fallback URL from context payload or tab lookup.");
        }
        const resolvedMeta = await resolveTabMeta(sender.tab?.id, fallbackUrl, fallbackTitle);

        await chrome.storage.session.set({
          lastSelection: {
            tabId: sender.tab.id,
            text: message.text,
            pageUrl: resolvedMeta.url || fallbackUrl || "",
            pageTitle: resolvedMeta.title || fallbackTitle || "",
            timestamp: Date.now(),
            contextData: message.contextData || null // Enriched DOM details
          }
        });
        sendResponse({ success: true });
      } catch (err) {
        console.error("Failed to save selection context in message listener:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message channel open for async sendResponse
  }
});

// Keep side panel available while navigating tabs once user has opened it.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (activeSidePanelTabs.size > 0) {
    await enableSidePanelForTab(activeInfo.tabId, { silent: true });
  }
});

// Clean up set on tab closure
chrome.tabs.onRemoved.addListener(async (tabId) => {
  activeSidePanelTabs.delete(tabId);
  try {
    const result = await chrome.storage.local.get("tabStates");
    if (result.tabStates && result.tabStates[tabId]) {
      delete result.tabStates[tabId];
      await chrome.storage.local.set({ tabStates: result.tabStates });
      console.log(`🔮 [ContextLens Background] Cleaned up persisted tabState for closed tab ${tabId}`);
    }
  } catch (err) {
    console.error("🔮 [ContextLens Background] Failed to clean up closed tab state:", err);
  }
});
