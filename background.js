// Background Service Worker for ContextLens

// Track which tabs have side panel active
let activeSidePanelTabs = new Set();

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
    contexts: ["selection"]
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
      text: info.selectionText,
      pageUrl: tab.url,
      pageTitle: tab.title,
      timestamp: Date.now(),
      contextData: null // Will be populated if content script replies
    };

    // 2. Safely attempt to query the active tab's content script and save context asynchronously
    (async () => {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_RICH_CONTEXT" });
        if (response && response.success && response.contextData) {
          console.log("🔮 [ContextLens Background] Successfully retrieved rich DOM context for menu selection!");
          selectionPayload.contextData = response.contextData;
        }
      } catch (err) {
        console.log("🔮 [ContextLens Background] Content script not ready or no rich context cached. Using fallback.", err.message);
      }

      // 3. Save selection details to session storage (notifies side panel)
      await chrome.storage.session.set({
        lastSelection: selectionPayload
      });
    })();
  }
});

// Handle messages from content script (Floating Action Button click)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
chrome.tabs.onRemoved.addListener((tabId) => {
  activeSidePanelTabs.delete(tabId);
});
