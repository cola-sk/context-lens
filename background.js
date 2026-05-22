// Background Service Worker for ContextLens

// Track which tabs have side panel active
let activeSidePanelTabs = new Set();

// Cache of the latest right-clicked context per tab
let tabRightClickContexts = {};

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
  chrome.contextMenus.create({
    id: "ask-contextlens",
    title: "Ask ContextLens",
    contexts: ["all"]
  });

  // Disable side panel globally by default
  chrome.sidePanel.setOptions({
    enabled: false
  });
});

// Handle toolbar action clicks (extension icon)
chrome.action.onClicked.addListener((tab) => {
  activeSidePanelTabs.add(tab.id);
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "sidepanel/sidepanel.html",
    enabled: true
  });
  
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
  if (info.menuItemId === "ask-contextlens") {
    activeSidePanelTabs.add(tab.id);
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidepanel/sidepanel.html",
      enabled: true
    });

    // 1. Open the side panel synchronously for the active tab (preserves gesture)
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
      console.error("🔮 [ContextLens Background] Failed to open side panel on context menu click:", err);
    });

    let selectionPayload = {
      tabId: tab.id,
      text: info.selectionText || "",
      pageUrl: tab.url,
      pageTitle: tab.title,
      timestamp: Date.now(),
      contextData: null
    };

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
        try {
          // If no fresh cache, query the content script of the specific frame that was clicked
          const response = await chrome.tabs.sendMessage(
            tab.id, 
            { type: "GET_RICH_CONTEXT" }, 
            { frameId: info.frameId }
          );
          if (response && response.success && response.contextData) {
            console.log("🔮 [ContextLens Background] Successfully retrieved rich DOM context from active frame!");
            selectionPayload.contextData = response.contextData;
            if (!selectionPayload.text && response.contextData.selectedText) {
              selectionPayload.text = response.contextData.selectedText;
            }
          }
        } catch (err) {
          console.log("🔮 [ContextLens Background] Active frame not ready or no context cached. Using fallback.", err.message);
          
          // Self-heal: dynamically inject content script if missing
          if (err.message.includes("Could not establish connection") || err.message.includes("Receiving end does not exist")) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id, frameIds: [info.frameId || 0] },
                files: ["content.js"]
              });
              await chrome.scripting.insertCSS({
                target: { tabId: tab.id, frameIds: [info.frameId || 0] },
                files: ["content.css"]
              });
              console.log("🔮 [ContextLens Background] Dynamically self-healed and injected content script into frame!");

              // Retry once after dynamic injection so first interaction on a freshly-opened page
              // can still capture rich context instead of falling back to empty payload.
              try {
                const retried = await chrome.tabs.sendMessage(
                  tab.id,
                  { type: "GET_RICH_CONTEXT" },
                  { frameId: info.frameId }
                );
                if (retried && retried.success && retried.contextData) {
                  selectionPayload.contextData = retried.contextData;
                  if (!selectionPayload.text && retried.contextData.selectedText) {
                    selectionPayload.text = retried.contextData.selectedText;
                  }
                }
              } catch (retryErr) {
                console.log("🔮 [ContextLens Background] Retry after injection still failed:", retryErr.message);
              }
            } catch (injectErr) {
              console.warn("🔮 [ContextLens Background] Self-healing injection failed:", injectErr);
            }
          }
        }

        if (!selectionPayload.contextData) {
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
    activeSidePanelTabs.add(sender.tab.id);
    chrome.sidePanel.setOptions({
      tabId: sender.tab.id,
      path: "sidepanel/sidepanel.html",
      enabled: true
    });

    // 1. Open side panel for the tab synchronously (preserves gesture context across message boundaries)
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch((err) => {
      console.error("🔮 [ContextLens Background] Failed to open side panel from content script message:", err);
    });

    // 2. Save selection context with rich payload to session storage and reply asynchronously
    (async () => {
      try {
        await chrome.storage.session.set({
          lastSelection: {
            tabId: sender.tab.id,
            text: message.text,
            pageUrl: sender.tab.url,
            pageTitle: sender.tab.title,
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

// Track active tab and dynamically close side panel on inactive tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  if (!activeSidePanelTabs.has(tabId)) {
    try {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: false
      });
    } catch (e) {
      // restricted chrome pages or unloaded tabs
    }
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
