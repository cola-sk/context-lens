// Content script for ContextLens - Handles floating trigger button & rich DOM context extraction

let floatBtn = null;
let currentSelectionText = "";
let currentSelectionContext = null; // Caches rich DOM context on selection mouseup
let lastRightClickElement = null;
let lastRightClickContext = null; // Caches rich DOM context on right click

console.log("🔮 [ContextLens] Content script loaded successfully! Ready to capture text selections with DOM context.");

// --- RICH DOM CONTEXT EXTRACTORS ---

// Find the nearest preceding heading element in document order
function findPrecedingHeading(node) {
  try {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    let closestHeading = null;
    
    for (const h of headings) {
      // Check if heading appears before our node in document order
      if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        closestHeading = h;
      } else {
        // Once we pass the node, we can stop traversing headings
        break;
      }
    }
    if (closestHeading) {
      return {
        tag: closestHeading.tagName,
        text: closestHeading.innerText.trim()
      };
    }
  } catch (e) {
    console.warn("🔮 [ContextLens] Error finding preceding heading:", e);
  }
  return null;
}

// Find if selection is inside a code block (<pre> or <code>)
function findEnclosingCodeBlock(node) {
  let current = node;
  while (current && current !== document.documentElement) {
    if (current.tagName === "PRE" || current.tagName === "CODE") {
      let language = "";
      
      // Check classes on both current tag and its pre parent (common for highlights)
      const checkElements = [current];
      if (current.parentElement && current.parentElement.tagName === "PRE") {
        checkElements.push(current.parentElement);
      }
      
      for (const el of checkElements) {
        for (const cls of Array.from(el.classList)) {
          if (cls.startsWith("language-") || cls.startsWith("lang-")) {
            language = cls.replace("language-", "").replace("lang-", "");
            break;
          }
        }
        if (language) break;
      }
      
      return {
        language: language || "code",
        fullCode: current.innerText.trim()
      };
    }
    current = current.parentElement;
  }
  return null;
}

// Find if selection is inside a table, and format headers + active row into simplified Markdown
function findEnclosingTable(node) {
  let current = node;
  while (current && current !== document.documentElement) {
    if (current.tagName === "TABLE") {
      try {
        const ths = Array.from(current.querySelectorAll("th"));
        let headers = ths.map(th => th.innerText.trim());
        
        // Fallback: Check first row tds if no ths
        if (headers.length === 0) {
          const firstRow = current.querySelector("tr");
          if (firstRow) {
            headers = Array.from(firstRow.querySelectorAll("td")).map(td => td.innerText.trim());
          }
        }
        
        // Find active row
        let activeRowNode = node;
        while (activeRowNode && activeRowNode !== current) {
          if (activeRowNode.tagName === "TR") {
            break;
          }
          activeRowNode = activeRowNode.parentElement;
        }
        
        let rowData = [];
        if (activeRowNode && activeRowNode.tagName === "TR") {
          rowData = Array.from(activeRowNode.querySelectorAll("td, th")).map(td => td.innerText.trim());
        }
        
        if (headers.length > 0 || rowData.length > 0) {
          let md = "| " + (headers.length > 0 ? headers.join(" | ") : rowData.map((_, i) => `Col ${i+1}`).join(" | ")) + " |\n";
          md += "| " + (headers.length > 0 ? headers.map(() => "---").join(" | ") : rowData.map(() => "---").join(" | ")) + " |\n";
          if (rowData.length > 0) {
            md += "| " + rowData.join(" | ") + " |\n";
          }
          return md.trim();
        }
      } catch (e) {
        console.warn("🔮 [ContextLens] Error formatting table context:", e);
      }
      return null;
    }
    current = current.parentElement;
  }
  return null;
}

// Extract up to N characters of preceding and succeeding text
function getSurroundingText(range, charLimit = 800) {
  try {
    const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
      
    const containerText = container.innerText || "";
    const selectedText = range.toString();
    
    const startIdx = containerText.indexOf(selectedText);
    if (startIdx === -1) {
      // Sibling fallback if selected text spans across multiple elements
      let beforeText = "";
      let afterText = "";
      
      let prev = container.previousElementSibling;
      let count = 0;
      while (prev && beforeText.length < charLimit && count < 3) {
        beforeText = prev.innerText + "\n" + beforeText;
        prev = prev.previousElementSibling;
        count++;
      }
      
      let next = container.nextElementSibling;
      count = 0;
      while (next && afterText.length < charLimit && count < 3) {
        afterText = afterText + "\n" + next.innerText;
        next = next.nextElementSibling;
        count++;
      }
      
      return {
        before: beforeText.substring(Math.max(0, beforeText.length - charLimit)).trim(),
        after: afterText.substring(0, charLimit).trim()
      };
    }
    
    const before = containerText.substring(Math.max(0, startIdx - charLimit), startIdx).trim();
    const after = containerText.substring(startIdx + selectedText.length, Math.min(containerText.length, startIdx + selectedText.length + charLimit)).trim();
    
    return { before, after };
  } catch (e) {
    console.warn("🔮 [ContextLens] Error capturing surrounding text window:", e);
  }
  return { before: "", after: "" };
}

// Extract a highly simplified, token-efficient text extraction of the entire article/webpage
function getFullPageSimplifiedText(maxChars = 6000) {
  try {
    // 1. Identify best semantic content containers
    const selectors = [
      "article",
      "main",
      "[role='main']",
      ".post-content",
      ".article-content",
      ".markdown-body",
      "#content",
      ".content"
    ];
    
    let root = null;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText && el.innerText.trim().length > 300) {
        root = el;
        break;
      }
    }
    
    // Fallback to document.body
    if (!root) {
      root = document.body;
    }
    
    // 2. Clone the container node to avoid messing up the live DOM
    const clone = root.cloneNode(true);
    
    // 3. Remove non-content/noisy nodes
    const noiseSelectors = [
      "script",
      "style",
      "noscript",
      "iframe",
      "nav",
      "footer",
      "header",
      "aside",
      ".sidebar",
      ".nav",
      ".footer",
      ".header",
      ".comments",
      ".advertisement",
      ".ads",
      ".share-buttons",
      "button",
      "select",
      "input",
      "form"
    ];
    
    noiseSelectors.forEach(selector => {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });
    
    // 4. Extract and clean up text
    let text = clone.innerText || clone.textContent || "";
    
    // Clean up multiple newlines, tabs, and duplicate spaces
    text = text
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")       // reduce multiple spaces/tabs to a single space
      .replace(/\n\s*\n+/g, "\n\n")  // reduce multiple blank lines to a double newline
      .trim();
      
    if (text.length > maxChars) {
      text = text.substring(0, maxChars) + "\n\n[... content truncated for token efficiency ...]";
    }
    
    return text;
  } catch (e) {
    console.warn("🔮 [ContextLens] Error extracting full page simplified text:", e);
    return "";
  }
}

// Build a clean CSS semantic path/breadcrumb for the element (e.g. main > article > section > p)
function buildSemanticPath(node) {
  try {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const path = [];
    const semanticTags = ["ARTICLE", "SECTION", "MAIN", "HEADER", "FOOTER", "NAV", "ASIDE", "FORM", "TABLE", "UL", "OL", "DETAILS"];
    
    while (current && current !== document.body) {
      const tagName = current.tagName;
      if (semanticTags.includes(tagName) || tagName.startsWith("H")) {
        let identifier = tagName.toLowerCase();
        if (current.id) {
          identifier += `#${current.id}`;
        } else if (current.className) {
          const firstClass = current.className.split(/\s+/)[0];
          if (firstClass && typeof firstClass === "string" && !firstClass.includes("{")) {
            identifier += `.${firstClass}`;
          }
        }
        path.unshift(identifier);
      }
      current = current.parentElement;
    }
    return path.join(" > ");
  } catch (e) {
    console.warn("🔮 [ContextLens] Error building semantic path:", e);
    return "";
  }
}

// --- FLOATING TRIGGER BUTTON DOM LOGIC ---

// Initialize the floating button DOM element
function createFloatingButton() {
  if (floatBtn) return floatBtn;

  console.log("🔮 [ContextLens] Creating floating trigger button element in DOM...");
  floatBtn = document.createElement("div");
  floatBtn.id = "contextlens-floating-btn";
  floatBtn.className = "contextlens-reset contextlens-hidden";
  
  // High-tech lens SVG icon
  floatBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Context Text Lines (High-tech scanning target) -->
      <path d="M4 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
      <path d="M4 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
      <path d="M4 16h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
      <path d="M4 21h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
      
      <!-- AI Lens (Concentric scanning circles and handle) -->
      <circle cx="13" cy="14" r="5" stroke="currentColor" stroke-width="2"/>
      <circle cx="13" cy="14" r="2" fill="currentColor" opacity="0.3"/>
      <path d="M16.5 17.5l3.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      
      <!-- AI Sparkle Star -->
      <path d="M19 2c0 1.6 1.4 3 3 3c-1.6 0-3 1.4-3 3c0-1.6-1.4-3-3-3c1.6 0 3-1.4 3-3z" fill="currentColor"/>
    </svg>
    <span>探索</span>
  `;

  floatBtn.addEventListener("click", handleButtonClick);
  (document.body || document.documentElement).appendChild(floatBtn);
  console.log("🔮 [ContextLens] Floating button appended to document.");
  return floatBtn;
}

// Handle selection end
function handleMouseUp(e) {
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection) return;

    const selectedText = selection.toString().trim();
    
    // Check if click target is our button
    if (e.target.closest("#contextlens-floating-btn")) {
      return;
    }

    if (selectedText.length === 0) {
      hideButton();
      return;
    }

    currentSelectionText = selectedText;
    showButtonAtSelection(selection);
  }, 30);
}

// Hide the floating button
function hideButton() {
  if (floatBtn && !floatBtn.classList.contains("contextlens-hidden")) {
    floatBtn.classList.add("contextlens-hidden");
    floatBtn.style.top = "";
    floatBtn.style.left = "";
  }
}

// Show button positioned nicely relative to the text selection
function showButtonAtSelection(selection) {
  if (selection.rangeCount === 0) return;

  const btn = createFloatingButton();
  
  try {
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    
    let rect = null;
    if (rects.length > 0) {
      rect = rects[rects.length - 1];
    } else {
      rect = range.getBoundingClientRect();
    }

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      return;
    }
    
    // Viewport-relative coordinates + scroll offset
    const viewportTop = rect.bottom + window.scrollY + 8;
    const viewportLeft = rect.right + window.scrollX - 60;

    const btnWidth = 80;
    const btnHeight = 28;
    const maxLeft = window.innerWidth + window.scrollX - btnWidth - 16;
    const minLeft = window.scrollX + 16;
    
    let left = Math.max(minLeft, Math.min(viewportLeft, maxLeft));
    let top = viewportTop;

    if (top + btnHeight > window.innerHeight + window.scrollY - 16) {
      const firstRect = rects[0] || rect;
      top = firstRect.top + window.scrollY - btnHeight - 8;
    }

    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
    btn.classList.remove("contextlens-hidden");

    // --- POPULATE RICH SEMANTIC CONTEXT ---
    const ancestor = range.commonAncestorContainer;
    const enclosingCode = findEnclosingCodeBlock(ancestor);
    const enclosingTable = findEnclosingTable(ancestor);
    const parentHeading = findPrecedingHeading(ancestor);
    const surrounding = getSurroundingText(range, 800);
    
    let contentType = "text";
    if (enclosingCode) contentType = "code";
    else if (enclosingTable) contentType = "table";

    // 1. Meta Description (Highly compressed webpage summary)
    const metaDesc = document.querySelector('meta[name="description"]')?.content || 
                     document.querySelector('meta[property="og:description"]')?.content || "";

    // 2. Semantic CSS Breadcrumb Path
    const semanticPath = buildSemanticPath(ancestor);

    // 3. Extract full page simplified text context
    const fullPageSimplified = getFullPageSimplifiedText(6000);

    currentSelectionContext = {
      contentType: contentType,
      selectedText: currentSelectionText,
      surroundingBefore: surrounding.before,
      surroundingAfter: surrounding.after,
      parentHeading: parentHeading ? `${parentHeading.tag}: ${parentHeading.text}` : "",
      codeBlock: enclosingCode, // { language, fullCode }
      tableBlock: enclosingTable, // Markdown string
      pageTitle: document.title,
      pageUrl: window.location.href,
      pageDescription: metaDesc.trim(),
      semanticPath: semanticPath,
      fullPageSimplifiedText: fullPageSimplified
    };
    
    console.log(`🔮 [ContextLens] Rich context compiled successfully. Type: ${contentType}`);
  } catch (err) {
    console.error("❌ [ContextLens] Failed to position floating button or parse DOM context:", err);
  }
}

// Compile a rich DOM context for an arbitrary element (used on right click)
function compileElementContext(element) {
  if (!element) return null;

  try {
    const range = document.createRange();
    range.selectNode(element);

    const selectedText = element.innerText ? element.innerText.trim() : (element.textContent ? element.textContent.trim() : "");
    if (!selectedText) return null; // Ignore empty containers

    const enclosingCode = findEnclosingCodeBlock(element);
    const enclosingTable = findEnclosingTable(element);
    const parentHeading = findPrecedingHeading(element);
    const surrounding = getSurroundingText(range, 800);

    let contentType = "text";
    if (enclosingCode) contentType = "code";
    else if (enclosingTable) contentType = "table";

    const metaDesc = document.querySelector('meta[name="description"]')?.content || 
                     document.querySelector('meta[property="og:description"]')?.content || "";

    const semanticPath = buildSemanticPath(element);
    const fullPageSimplified = getFullPageSimplifiedText(6000);

    return {
      contentType: contentType,
      selectedText: selectedText,
      surroundingBefore: surrounding.before,
      surroundingAfter: surrounding.after,
      parentHeading: parentHeading ? `${parentHeading.tag}: ${parentHeading.text}` : "",
      codeBlock: enclosingCode,
      tableBlock: enclosingTable,
      pageTitle: document.title,
      pageUrl: window.location.href,
      pageDescription: metaDesc.trim(),
      semanticPath: semanticPath,
      fullPageSimplifiedText: fullPageSimplified
    };
  } catch (err) {
    console.warn("🔮 [ContextLens] Error compiling single element context:", err);
    return null;
  }
}

// Triggered when user clicks the floating button
async function handleButtonClick(e) {
  e.preventDefault();
  e.stopPropagation();

  if (!currentSelectionText) return;

  console.log(`🔮 [ContextLens] Lens button clicked! Sending selection context...`);
  floatBtn.classList.add("contextlens-clicked");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "OPEN_SIDE_PANEL",
      text: currentSelectionText,
      contextData: currentSelectionContext // Pass complete parsed rich context
    });
    
    if (response && response.success) {
      window.getSelection().removeAllRanges();
      hideButton();
    } else {
      console.error("❌ [ContextLens] Background rejected side panel open:", response?.error);
    }
  } catch (err) {
    if (err.message && err.message.includes("context invalidated")) {
      console.warn("🔮 [ContextLens] Extension context was invalidated (extension reloaded/updated). Guiding user to refresh.");
      showInvalidatedToast();
    } else {
      console.error("❌ [ContextLens] Failed to message background script:", err);
    }
  } finally {
    if (floatBtn) {
      floatBtn.classList.remove("contextlens-clicked");
    }
  }
}

// Show a sleek, premium toast instructing the user to refresh the page
function showInvalidatedToast() {
  if (document.getElementById("contextlens-invalidated-toast")) return;

  const toast = document.createElement("div");
  toast.id = "contextlens-invalidated-toast";
  toast.style.cssText = `
    position: fixed !important;
    top: 20px !important;
    left: 50% !important;
    transform: translateX(-50%) translateY(-20px) !important;
    background: rgba(13, 20, 38, 0.96) !important;
    border: 1px solid rgba(239, 68, 68, 0.5) !important;
    box-shadow: 0 0 20px 2px rgba(239, 68, 68, 0.2), 0 10px 30px rgba(0, 0, 0, 0.6) !important;
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(12px) !important;
    color: #f8fafc !important;
    padding: 12px 20px !important;
    border-radius: 12px !important;
    z-index: 2147483647 !important; /* Maximum possible z-index */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    opacity: 0 !important;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
  `;
  
  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span style="line-height: 1.4;">ContextLens 已更新或重新加载。<strong>请刷新当前网页</strong>以继续使用。</span>
    <button id="contextlens-toast-refresh-btn" style="
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      border: none !important;
      color: white !important;
      padding: 6px 12px !important;
      font-size: 11px !important;
      font-weight: bold !important;
      border-radius: 6px !important;
      cursor: pointer !important;
      margin-left: 4px !important;
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3) !important;
      transition: all 0.2s ease !important;
    ">刷新页面</button>
  `;

  document.body.appendChild(toast);
  
  // Trigger entry animation
  requestAnimationFrame(() => {
    // Overwrite the style attributes dynamically for transitions
    toast.style.setProperty("transform", "translateX(-50%) translateY(0)", "important");
    toast.style.setProperty("opacity", "1", "important");
  });

  // Attach button event
  toast.querySelector("#contextlens-toast-refresh-btn").addEventListener("click", () => {
    window.location.reload();
  });

  // Auto clean up floating button to prevent dead triggers
  try {
    hideButton();
    if (floatBtn) {
      floatBtn.remove();
      floatBtn = null;
    }
    document.removeEventListener("mouseup", handleMouseUp);
  } catch (e) {}
}

// --- EVENT LISTENERS ---

document.addEventListener("mouseup", handleMouseUp);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideButton();
  }
});

window.addEventListener("scroll", () => {
  if (floatBtn && !floatBtn.classList.contains("contextlens-hidden")) {
    hideButton();
  }
}, { passive: true });

document.addEventListener("mousedown", (e) => {
  if (floatBtn && !floatBtn.classList.contains("contextlens-hidden")) {
    if (!e.target.closest("#contextlens-floating-btn")) {
      setTimeout(() => {
        const selection = window.getSelection();
        if (selection.toString().trim().length === 0) {
          hideButton();
        }
      }, 50);
    }
  }
});

// --- MESSAGING CHANNEL FOR RIGHT-CLICK MENU SUPPORT ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_RICH_CONTEXT") {
    console.log("🔮 [ContextLens] Background requested rich selection context.");
    const selection = window.getSelection();
    const hasSelection = selection && selection.toString().trim().length > 0;
    
    if (hasSelection && currentSelectionContext) {
      sendResponse({ success: true, contextData: currentSelectionContext });
    } else if (lastRightClickContext) {
      sendResponse({ success: true, contextData: lastRightClickContext });
    } else {
      sendResponse({ success: false });
    }
  }
  return true;
});

// Track the right-clicked element and compile its context
document.addEventListener("contextmenu", (e) => {
  lastRightClickElement = e.target;
  lastRightClickContext = compileElementContext(e.target);
});
