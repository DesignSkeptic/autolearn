/** @type {number|null} ID of the active textbook tab */
let textbookTabId = null;

/** @type {number|null} ID of the active AI assistant tab */
let aiTabId = null;

/** @type {string|null} Type of AI assistant ("chatgpt", "gemini", or "deepseek") */
let aiType = null;

/** @type {number|null} ID of the last active tab */
let lastActiveTabId = null;

/** @type {boolean} Flag indicating if a question is currently being processed */
let processingQuestion = false;

/** @type {number|null} Window ID containing the textbook tab */
let textbookWindowId = null;

/** @type {number|null} Window ID containing the AI assistant tab */
let aiWindowId = null;

/** @type {string} Current website URL for textbook matching */
let currentWebsiteUrl = "textbook";

/** @type {Set<number>} Set of tab IDs that have had content scripts injected */
let injectedTabs = new Set();

/**
 * Tracks the last active tab ID when tabs are switched
 * @listens chrome.tabs.onActivated
 */
chrome.tabs.onActivated.addListener((activeInfo) => {
  lastActiveTabId = activeInfo.tabId;
});

/**
 * Sends a message to a tab with retry functionality
 * @param {number} tabId - ID of the tab to send the message to
 * @param {Object} message - Message to send
 * @param {number} maxAttempts - Maximum number of attempts to send the message
 * @param {number} delay - Delay in ms between attempts
 * @returns {Promise<any>} Promise resolving to the response or rejecting with an error
 */
function sendMessageWithRetry(tabId, message, maxAttempts = 3, delay = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function attemptSend() {
      attempts++;
      chrome.tabs.sendMessage(tabId, message, (response) => {
        // Success case
        if (!chrome.runtime.lastError) {
          resolve(response);
          return;
        }
        
        // Max attempts reached
        if (attempts >= maxAttempts) {
          reject(chrome.runtime.lastError);
          return;
        }
        
        // Try again after delay
        setTimeout(attemptSend, delay);
      });
    }

    attemptSend();
  });
}

/**
 * Focuses a specific tab
 * @param {number} tabId - ID of the tab to focus
 * @returns {Promise<boolean>} Whether the tab was successfully focused
 */
async function focusTab(tabId) {
  if (!tabId) return false;

  try {
    const tab = await chrome.tabs.get(tabId);

    if (tab.windowId !== chrome.windows.WINDOW_ID_CURRENT) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    
    await chrome.tabs.update(tabId, { active: true });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Finds and stores tab IDs for textbook and AI tabs
 * @returns {Promise<void>}
 */
async function findAndStoreTabs() {
  // Get the current website URL from storage, checking sync first, then local
  let storageData = await chrome.storage.sync.get(["websiteUrl", "aiModel"]);
  
  // If not in sync storage, try local storage
  if (!storageData.websiteUrl) {
    const localData = await chrome.storage.local.get(["websiteUrl"]);
    if (localData.websiteUrl) {
      storageData.websiteUrl = localData.websiteUrl;
      // Sync the data for future use
      chrome.storage.sync.set({ websiteUrl: localData.websiteUrl });
    }
  }
  
  currentWebsiteUrl = storageData.websiteUrl || "textbook";
  console.log("Using website URL for tab matching:", currentWebsiteUrl);
  
  const textbookTabs = await chrome.tabs.query({
    url: `https://learning.${currentWebsiteUrl}.com/*`,
  });
  
  // Store textbook tab data and inject content script if found
  if (textbookTabs.length > 0) {
    textbookTabId = textbookTabs[0].id;
    textbookWindowId = textbookTabs[0].windowId;
    console.log("Found textbook tab:", textbookTabId);
    
    // Ensure content script is injected
    injectContentScript(textbookTabId);
  }

  const aiModel = storageData.aiModel || "chatgpt";
  aiType = aiModel;

  const aiUrlMap = {
    chatgpt: "https://chatgpt.com/*",
    gemini: "https://gemini.google.com/*",
    deepseek: "https://chat.deepseek.com/*"
  };

  const aiUrl = aiUrlMap[aiModel];
  if (!aiUrl) return;

  const tabs = await chrome.tabs.query({ url: aiUrl });
  if (tabs.length === 0) return;

  aiTabId = tabs[0].id;
  aiWindowId = tabs[0].windowId;
}

/**
 * Determines if tabs should be focused based on whether they're in the same window
 * @returns {Promise<boolean>} Whether tabs should be focused
 */
async function shouldFocusTabs() {
  await findAndStoreTabs();
  return textbookWindowId === aiWindowId;
}

/**
 * Processes a question from the textbook and sends it to the AI tab
 * @param {Object} message - The message containing the question
 * @returns {Promise<void>}
 */
async function processQuestion(message) {
  if (processingQuestion) return;
  
  processingQuestion = true;

  try {
    await findAndStoreTabs();

    // Handle missing AI tab
    if (!aiTabId) {
      await sendMessageWithRetry(textbookTabId, {
        type: "alertMessage",
        message: `Please open ${aiType} in another tab before using automation.`,
      });
      processingQuestion = false;
      return;
    }

    // Use source tab if textbook tab not found
    if (!textbookTabId) {
      textbookTabId = message.sourceTabId;
    }

    const sameWindow = await shouldFocusTabs();

    // Focus AI tab if in same window
    if (sameWindow) {
      await focusTab(aiTabId);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Send question to AI tab
    await sendMessageWithRetry(aiTabId, {
      type: "receiveQuestion",
      question: message.question,
    });

    // Don't refocus if tabs are in different windows
    if (!sameWindow) return;
    
    // Don't refocus if no last active tab
    if (!lastActiveTabId) return;
    
    // Don't refocus if AI tab was the last active tab
    if (lastActiveTabId === aiTabId) return;
    
    // Refocus to previous tab
    setTimeout(async () => {
      await focusTab(lastActiveTabId);
    }, 1000);
  } catch (error) {
    // Return early if textbook tab not available
    if (!textbookTabId) {
      processingQuestion = false;
      return;
    }
    
    // Send error message to textbook tab
    await sendMessageWithRetry(textbookTabId, {
      type: "alertMessage",
      message: `Error communicating with ${aiType}. Please make sure it is open in another tab (You may need to refresh the page)`,
    });
  } finally {
    processingQuestion = false;
  }
}

/**
 * Processes AI response and sends it back to the textbook tab
 * @param {Object} message - The message containing the AI response
 * @returns {Promise<void>}
 */
async function processResponse(message) {
  try {
    // Find textbook tab if not already stored
    if (!textbookTabId) {
      await findAndStoreTabs();
      if (!textbookTabId) return;
    }

    const sameWindow = await shouldFocusTabs();

    // Focus textbook tab if in same window
    if (sameWindow) {
      await focusTab(textbookTabId);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Send response back to textbook tab
    await sendMessageWithRetry(textbookTabId, {
      type: "processChatGPTResponse",
      response: message.response,
    });
  } catch (error) {
    console.error("Error processing AI response:", error);
  }
}

/**
 * Injects content script into textbook tabs
 * @param {number} tabId - ID of the tab to inject the script into
 * @returns {Promise<void>}
 */
async function injectContentScript(tabId) {
  // Check if the tab is still valid
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      console.log(`Tab ${tabId} no longer exists, skipping injection`);
      return;
    }
    
    // Check if we've already injected into this tab
    if (injectedTabs.has(tabId)) {
      console.log(`Content script already injected into tab ${tabId}, verifying...`);
      
      // Verify the script is still active by sending a ping message
      try {
        await sendMessageWithRetry(tabId, { type: "ping" }, 1);
        console.log(`Content script is still active in tab ${tabId}`);
        return;
      } catch (err) {
        // If we can't reach the content script, it means it's no longer active
        console.log(`Content script not responding in tab ${tabId}, will reinject`);
        injectedTabs.delete(tabId);
      }
    }
    
    console.log(`Injecting content script into tab ${tabId}`);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content-scripts/education.js"]
    });
    
    injectedTabs.add(tabId);
    console.log(`Content script successfully injected into tab ${tabId}`);
  } catch (error) {
    console.error(`Error injecting content script into tab ${tabId}:`, error);
    // Remove from tracked tabs if injection failed
    injectedTabs.delete(tabId);
  }
}

/**
 * Checks if a URL matches the current textbook website setting
 * @param {string} url - The URL to check
 * @returns {boolean} Whether the URL matches the current textbook website
 */
function isTextbookUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === `learning.${currentWebsiteUrl}.com`;
  } catch (error) {
    return false;
  }
}

/**
 * Listens for messages from content scripts and other extension components
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle messages from tab content scripts
  if (sender.tab) {
    message.sourceTabId = sender.tab.id;
    const url = sender.tab.url;

    // Handle content script ready notification
    if (message.type === "contentScriptReady") {
      console.log(`Content script reported ready in tab ${sender.tab.id}`);
      if (!injectedTabs.has(sender.tab.id)) {
        injectedTabs.add(sender.tab.id);
      }
    }
    
    // Check and store textbook tab
    if (isTextbookUrl(url)) {
      console.log(`Detected textbook URL: ${url} in tab ${sender.tab.id}`);
      textbookTabId = sender.tab.id;
      textbookWindowId = sender.tab.windowId;
      injectContentScript(sender.tab.id);
    }
    
    // Check and store ChatGPT tab
    if (url.includes("chatgpt.com")) {
      aiTabId = sender.tab.id;
      aiWindowId = sender.tab.windowId;
      aiType = "chatgpt";
    }
    
    // Check and store Gemini tab
    if (url.includes("gemini.google.com")) {
      aiTabId = sender.tab.id;
      aiWindowId = sender.tab.windowId;
      aiType = "gemini";
    }
    
    // Check and store DeepSeek tab
    if (url.includes("chat.deepseek.com")) {
      aiTabId = sender.tab.id;
      aiWindowId = sender.tab.windowId;
      aiType = "deepseek";
    }
  }

  // Handle question from textbook
  if (message.type === "sendQuestionToChatGPT") {
    processQuestion(message);
    sendResponse({ received: true });
    return true;
  }

  // Handle response from AI
  if (message.type === "chatGPTResponse" || 
      message.type === "geminiResponse" || 
      message.type === "deepseekResponse") {
    processResponse(message);
    sendResponse({ received: true });
    return true;
  }

  // Handle settings page opening
  if (message.type === "openSettings") {
    chrome.tabs.create({ url: chrome.runtime.getURL("settings/index.html") });
    sendResponse({ received: true });
    return true;
  }

  // Handle website URL update
  if (message.type === "updateWebsiteUrl") {
    currentWebsiteUrl = message.websiteUrl;
    // Clear injected tabs set since we're changing URLs
    injectedTabs.clear();
    sendResponse({ received: true });
    return true;
  }

  // Default case - not handling this message
  sendResponse({ received: false });
  return false;
});

/**
 * Initializes the background script on extension startup
 * @returns {Promise<void>}
 */
async function initialize() {
  // Try to get website URL from sync storage first, then local storage as fallback
  let syncData = await chrome.storage.sync.get(["websiteUrl"]);
  
  // Found in sync storage
  if (syncData.websiteUrl) {
    currentWebsiteUrl = syncData.websiteUrl;
    console.log("Retrieved website URL from sync storage:", currentWebsiteUrl);
    await findAndStoreTabs();
    injectContentScriptsIntoExistingTabs();
    return;
  }
  
  // Try local storage as fallback
  const localData = await chrome.storage.local.get(["websiteUrl"]);
  if (localData.websiteUrl) {
    // Found in local storage, copy to sync storage for consistency
    chrome.storage.sync.set({ websiteUrl: localData.websiteUrl });
    currentWebsiteUrl = localData.websiteUrl;
    console.log("Retrieved website URL from local storage:", currentWebsiteUrl);
  } else {
    // Not found in either storage, use default
    currentWebsiteUrl = "textbook";
    console.log("Using default website URL:", currentWebsiteUrl);
  }
  
  await findAndStoreTabs();
  
  // Inject content scripts into existing tabs
  await injectContentScriptsIntoExistingTabs();
}

/**
 * Injects content scripts into all existing textbook tabs
 * @returns {Promise<void>}
 */
async function injectContentScriptsIntoExistingTabs() {
  const existingTabs = await chrome.tabs.query({ url: `https://learning.${currentWebsiteUrl}.com/*` });
  for (const tab of existingTabs) {
    injectContentScript(tab.id);
  }
}

initialize();

/**
 * Handles extension installation to open the how-to-use page
 */
chrome.runtime.onInstalled.addListener((details) => {
  // Open the how-to-use page when the extension is installed or updated
  if (details.reason === 'install' || details.reason === 'update') {
    const settingsUrl = chrome.runtime.getURL("/settings/index.html");
    console.log("Extension installed/updated, opening how-to-use page at:", settingsUrl);
    chrome.tabs.create({ url: settingsUrl });
  }
});

/**
 * Handles extension icon clicks to open the settings page
 */
chrome.action.onClicked.addListener((tab) => {
  // Create a settings tab with proper URL
  const settingsUrl = chrome.runtime.getURL("/settings/index.html");
  console.log("Opening settings page at:", settingsUrl);
  chrome.tabs.create({ url: settingsUrl });
});

/**
 * Handles tab removal to clean up references
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === textbookTabId) textbookTabId = null;
  if (tabId === aiTabId) aiTabId = null;
  injectedTabs.delete(tabId);
});

/**
 * Listens for tab updates to inject or reinject content scripts
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process completed page loads with URLs
  if (changeInfo.status !== 'complete' || !tab.url) return;
  
  // Process textbook pages
  if (isTextbookUrl(tab.url)) {
    console.log(`Tab ${tabId} updated with textbook URL: ${tab.url}`);
    
    // Track as textbook tab
    textbookTabId = tabId;
    textbookWindowId = tab.windowId;
    
    // Make sure the tab has the content script
    await injectContentScript(tabId);
    return;
  }
  
  // Handle ChatGPT tab
  if (tab.url.includes("chatgpt.com")) {
    aiTabId = tabId;
    aiWindowId = tab.windowId;
    aiType = "chatgpt";
    return;
  }
  
  // Handle Gemini tab
  if (tab.url.includes("gemini.google.com")) {
    aiTabId = tabId;
    aiWindowId = tab.windowId;
    aiType = "gemini";
    return;
  }
  
  // Handle DeepSeek tab
  if (tab.url.includes("chat.deepseek.com")) {
    aiTabId = tabId;
    aiWindowId = tab.windowId;
    aiType = "deepseek";
  }
});
