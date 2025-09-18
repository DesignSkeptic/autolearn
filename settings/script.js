/**
 * Initializes the settings page functionality when the DOM is fully loaded
 */
document.addEventListener("DOMContentLoaded", function () {
  const chatgptButton = document.getElementById("chatgpt");
  const geminiButton = document.getElementById("gemini");
  const deepseekButton = document.getElementById("deepseek");
  const statusMessage = document.getElementById("status-message");
  const currentVersionElement = document.getElementById("current-version");
  const latestVersionElement = document.getElementById("latest-version");
  const versionStatusElement = document.getElementById("version-status");
  const checkUpdatesButton = document.getElementById("check-updates");
  const footerVersionElement = document.getElementById("footer-version");
  const minDelayInput = document.getElementById("min-delay");
  const maxDelayInput = document.getElementById("max-delay");
  const websiteUrlInput = document.getElementById("website-url");
  const saveWebsiteButton = document.getElementById("save-website");
  const turboModeCheckbox = document.getElementById("turbo-mode");

  /**
   * Navigation functionality - handles switching between different pages in settings
   */
  const navButtons = document.querySelectorAll('.nav-button');
  const pages = document.querySelectorAll('.page-content');

  // Hide all pages first, then show the how-to-use page by default
  pages.forEach(page => page.classList.remove('active'));
  document.getElementById('how-to-use-page').classList.add('active');

  navButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetPage = button.getAttribute('data-page');
      
      // Update active nav button
      navButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Show target page
      pages.forEach(page => page.classList.remove('active'));
      document.getElementById(targetPage + '-page').classList.add('active');
    });
  });

  // Add functionality for "Go to Settings" button in step 1
  const goToSettingsButton = document.getElementById('go-to-settings');
  if (goToSettingsButton) {
    goToSettingsButton.addEventListener('click', () => {
      // Update active nav button to settings
      navButtons.forEach(btn => btn.classList.remove('active'));
      document.querySelector('[data-page="settings"]').classList.add('active');
      
      // Show settings page
      pages.forEach(page => page.classList.remove('active'));
      document.getElementById('settings-page').classList.add('active');
    });
  }

  /**
   * Retrieve and display the current extension version from manifest
   */
  chrome.runtime.getManifest && chrome.runtime.getManifest().then
    ? chrome.runtime.getManifest().then(manifest => {
        const currentVersion = manifest.version;
        currentVersionElement.textContent = `v${currentVersion}`;
        footerVersionElement.textContent = `v${currentVersion}`;
      })
    : (() => {
        try {
          const currentVersion = chrome.runtime.getManifest().version;
          currentVersionElement.textContent = `v${currentVersion}`;
          footerVersionElement.textContent = `v${currentVersion}`;
        } catch (error) {
          console.error("Error getting manifest:", error);
          currentVersionElement.textContent = "v2.0";
          footerVersionElement.textContent = "v2.0";
        }
      })();

  /**
   * Initial setup
   */
  checkForUpdates();
  initializeDelaySettings();
  initializeWebsiteSettings();
  initializeTurboMode();

  /**
   * Event listeners
   */
  checkUpdatesButton.addEventListener("click", checkForUpdates);

  /**
   * Load and set the active AI model from storage
   */
  chrome.storage.sync.get("aiModel", function (data) {
    const currentModel = data.aiModel || "chatgpt";

    chatgptButton.classList.remove("active");
    geminiButton.classList.remove("active");
    deepseekButton.classList.remove("active");

    // Set active class based on the current model
    if (currentModel === "chatgpt") {
      chatgptButton.classList.add("active");
      checkModelAvailability(currentModel);
      return;
    }
    
    if (currentModel === "gemini") {
      geminiButton.classList.add("active");
      checkModelAvailability(currentModel);
      return;
    }
    
    if (currentModel === "deepseek") {
      deepseekButton.classList.add("active");
      checkModelAvailability(currentModel);
      return;
    }
    
    // Default case if no model matched
    checkModelAvailability(currentModel);
  });

  chatgptButton.addEventListener("click", function () {
    setActiveModel("chatgpt");
  });

  geminiButton.addEventListener("click", function () {
    setActiveModel("gemini");
  });

  deepseekButton.addEventListener("click", function () {
    setActiveModel("deepseek");
  });

  /**
 * Sets the active AI model and updates the UI accordingly
 * @param {string} model - The model to set as active ("chatgpt", "gemini", or "deepseek")
 */
function setActiveModel(model) {
  chrome.storage.sync.set({ aiModel: model }, function () {
    chatgptButton.classList.remove("active");
    geminiButton.classList.remove("active");
    deepseekButton.classList.remove("active");

    // Set active class based on the model
    if (model === "chatgpt") {
      chatgptButton.classList.add("active");
      checkModelAvailability(model);
      return;
    }
    
    if (model === "gemini") {
      geminiButton.classList.add("active");
      checkModelAvailability(model);
      return;
    }
    
    if (model === "deepseek") {
      deepseekButton.classList.add("active");
      checkModelAvailability(model);
      return;
    }
    
    // Default case if no model matched
    checkModelAvailability(model);
  });
}

  /**
 * Checks if the selected AI model is available in an open tab and updates status message
 * @param {string} currentModel - The model to check ("chatgpt", "gemini", or "deepseek")
 */
function checkModelAvailability(currentModel) {
  statusMessage.textContent = "Checking assistant availability...";
  statusMessage.className = "";

  chrome.tabs.query({ url: "https://chatgpt.com/*" }, (chatgptTabs) => {
    const chatgptAvailable = chatgptTabs.length > 0;

    chrome.tabs.query(
      { url: "https://gemini.google.com/*" },
      (geminiTabs) => {
        const geminiAvailable = geminiTabs.length > 0;

        chrome.tabs.query(
          { url: "https://chat.deepseek.com/*" },
          (deepseekTabs) => {
            const deepseekAvailable = deepseekTabs.length > 0;

            // Handle ChatGPT availability
            if (currentModel === "chatgpt") {
              if (!chatgptAvailable) {
                statusMessage.textContent = "Please open ChatGPT in another tab to use this assistant.";
                statusMessage.className = "error";
                return;
              }
              
              statusMessage.textContent = "ChatGPT tab is open and ready to use.";
              statusMessage.className = "success";
              return;
            }
            
            // Handle Gemini availability
            if (currentModel === "gemini") {
              if (!geminiAvailable) {
                statusMessage.textContent = "Please open Gemini in another tab to use this assistant.";
                statusMessage.className = "error";
                return;
              }
              
              statusMessage.textContent = "Gemini tab is open and ready to use.";
              statusMessage.className = "success";
              return;
            }
            
            // Handle DeepSeek availability
            if (currentModel === "deepseek") {
              if (!deepseekAvailable) {
                statusMessage.textContent = "Please open DeepSeek in another tab to use this assistant.";
                statusMessage.className = "error";
                return;
              }
              
              statusMessage.textContent = "DeepSeek tab is open and ready to use.";
              statusMessage.className = "success";
            }
          }
        );
      }
    );
  });
}

  /**
   * Periodic status check to ensure the selected AI model is still available
   */
  setInterval(() => {
    chrome.storage.sync.get("aiModel", function (data) {
      const currentModel = data.aiModel || "chatgpt";
      checkModelAvailability(currentModel);
    });
  }, 5000);

  /**
 * Checks for updates to the extension by comparing versions with the latest GitHub release
 * @returns {Promise<void>}
 */
async function checkForUpdates() {
    try {
      versionStatusElement.textContent = "Checking for updates...";
      versionStatusElement.className = "checking";
      checkUpdatesButton.disabled = true;
      latestVersionElement.textContent = "Checking...";

      const response = await fetch(
        "https://api.github.com/repos/DesignSkeptic/autolearn/releases/latest"
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const releaseData = await response.json();
      const latestVersion = releaseData.tag_name.replace("v", "");
      latestVersionElement.textContent = `v${latestVersion}`;

      // Get current version
      let currentVersion = "2.0"; // fallback
      try {
        if (chrome.runtime.getManifest) {
          const manifest = await chrome.runtime.getManifest();
          currentVersion = manifest.version;
        }
      } catch (error) {
        console.error("Error getting current version:", error);
      }

      const currentVersionParts = currentVersion.split(".").map(Number);
      const latestVersionParts = latestVersion.split(".").map(Number);

      let isUpdateAvailable = false;

      for (
        let i = 0;
        i < Math.max(currentVersionParts.length, latestVersionParts.length);
        i++
      ) {
        const current = currentVersionParts[i] || 0;
        const latest = latestVersionParts[i] || 0;

        if (latest > current) {
          isUpdateAvailable = true;
          break;
        }
        
        if (current > latest) {
          break;
        }
      }

      if (!isUpdateAvailable) {
        versionStatusElement.textContent = "You're using the latest version!";
        versionStatusElement.className = "up-to-date";
        versionStatusElement.style.cursor = "default";
        versionStatusElement.onclick = null;
        return;
      }
      
      versionStatusElement.textContent = `New version ${releaseData.tag_name} is available!`;
      versionStatusElement.className = "update-available";
      versionStatusElement.style.cursor = "pointer";
      versionStatusElement.onclick = () => {
        chrome.tabs.create({ url: releaseData.html_url });
      };
    } catch (error) {
      console.error("Error checking for updates:", error);
      versionStatusElement.textContent =
        "Error checking for updates. Please try again later.";
      versionStatusElement.className = "error";
      latestVersionElement.textContent = "Error";
    } finally {
      checkUpdatesButton.disabled = false;
    }
  }

  /**
 * Initializes delay settings inputs and event handlers
 */
function initializeDelaySettings() {
    // Guard clause: exit early if inputs don't exist
    if (!minDelayInput || !maxDelayInput) {
      console.error("Delay input fields not found");
      return;
    }

    // Load current settings from storage, default to 22 and 97
    chrome.storage.sync.get(["minDelay", "maxDelay"], function (data) {
      const minDelay = data.minDelay !== undefined ? data.minDelay : 22;
      const maxDelay = data.maxDelay !== undefined ? data.maxDelay : 97;
      
      // Set input values
      minDelayInput.value = minDelay;
      maxDelayInput.value = maxDelay;
      
      // Save default values if they don't exist yet
      if (data.minDelay === undefined || data.maxDelay === undefined) {
        chrome.storage.sync.set({ minDelay: 22, maxDelay: 97 });
      }
    });

    /**
     * Saves delay values to Chrome storage
     * @param {number} minDelay - Minimum delay in seconds
     * @param {number} maxDelay - Maximum delay in seconds
     */
    function saveDelayValues(minDelay, maxDelay) {
      chrome.storage.sync.set({ minDelay, maxDelay }, function () {
        // Guard clause: check if save was successful
        if (chrome.runtime.lastError) {
          console.error("Error saving delay settings:", chrome.runtime.lastError);
          return;
        }
        
        console.log("Delay settings saved:", { minDelay, maxDelay });
      });
    }

    // Add event listener for min delay changes (save on input)
    minDelayInput.addEventListener("input", function () {
      const minVal = parseInt(minDelayInput.value) || 0;
      const maxVal = parseInt(maxDelayInput.value) || 0;
      
      saveDelayValues(minVal, maxVal);
    });

    // Add event listener for max delay changes (save on input)
    maxDelayInput.addEventListener("input", function () {
      const minVal = parseInt(minDelayInput.value) || 0;
      const maxVal = parseInt(maxDelayInput.value) || 0;
      
      saveDelayValues(minVal, maxVal);
    });

    // Add validation on blur for min delay input
    minDelayInput.addEventListener("blur", function () {
      const minVal = parseInt(minDelayInput.value) || 0;
      const maxVal = parseInt(maxDelayInput.value) || 0;

      // Guard clause: validate if min > 0 and min > max (including when max is 0)
      if (minVal <= 0 || minVal <= maxVal) return;
      
      // Show alert to user
      alert(`Minimum delay (${minVal}s) cannot be greater than maximum delay (${maxVal}s). Setting maximum to ${minVal}s.`);
      
      // Correct the max value
      maxDelayInput.value = minVal;
      
      // Save the corrected values
      saveDelayValues(minVal, minVal);
    });

    // Add validation on blur for max delay input
    maxDelayInput.addEventListener("blur", function () {
      const minVal = parseInt(minDelayInput.value) || 0;
      const maxVal = parseInt(maxDelayInput.value) || 0;

      // Guard clause: validate if min > 0 and min > max (including when max is 0)
      if (minVal <= 0 || minVal <= maxVal) return;
      
      // Show alert to user
      alert(`Maximum delay (${maxVal}s) cannot be less than minimum delay (${minVal}s). Setting maximum to ${minVal}s.`);
      
      // Correct the max value
      maxDelayInput.value = minVal;
      
      // Save the corrected values
      saveDelayValues(minVal, minVal);
    });
  }

  /**
 * Initializes website URL settings and validation
 */
function initializeWebsiteSettings() {
    // Guard clause: exit early if inputs don't exist
    if (!websiteUrlInput || !saveWebsiteButton) {
      console.error("Website configuration elements not found");
      return;
    }

    // Load current website URL from storage (first from sync, then from local as fallback)
    chrome.storage.sync.get(["websiteUrl"], function (syncData) {
      // Use value from sync storage if available
      if (syncData.websiteUrl) {
        websiteUrlInput.value = syncData.websiteUrl;
        console.log("Loaded website URL from sync storage:", syncData.websiteUrl);
        return;
      }
      
      // Try local storage as fallback
      chrome.storage.local.get(["websiteUrl"], function (localData) {
        const websiteUrl = localData.websiteUrl || "textbook";
        websiteUrlInput.value = websiteUrl;
        console.log("Loaded website URL from local storage or using default:", websiteUrl);
        
        // Save to sync for future use
        if (localData.websiteUrl) {
          chrome.storage.sync.set({ websiteUrl: localData.websiteUrl });
          return;
        }
        
        // Save default if not set in either storage
        chrome.storage.sync.set({ websiteUrl: "textbook" });
        chrome.storage.local.set({ websiteUrl: "textbook" });
      });
    });

    // Helper function to save website URL with validation
    /**
     * Saves website URL after validation
     * @param {string} websiteUrl - The website URL to save
     * @param {boolean} showVisualFeedback - Whether to show visual feedback to the user
     * @returns {boolean} - Whether the save was successful
     */
    function saveWebsiteUrlWithValidation(websiteUrl, showVisualFeedback = true) {
      const trimmedUrl = websiteUrl.trim();
      
      if (!trimmedUrl) {
        // Don't show error on autosave, just exit
        return false;
      }

      // Basic validation - ensure it's a valid subdomain part
      const subdomainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
      if (!subdomainRegex.test(trimmedUrl)) {
        // Don't show error on autosave, just exit
        return false;
      }

      // Save the website URL to both local and sync storage for better persistence
      chrome.storage.local.set({ websiteUrl: trimmedUrl }, function() {
        console.log("Website URL autosaved to local storage:", trimmedUrl);
      });
      
      chrome.storage.sync.set({ websiteUrl: trimmedUrl }, function () {
        if (chrome.runtime.lastError) {
          console.error("Error saving website URL:", chrome.runtime.lastError);
          if (showVisualFeedback) {
            alert("Error saving website URL. Please try again.");
          }
          return;
        }
        
        console.log("Website URL saved to sync storage:", trimmedUrl);
        
        // Show confirmation only if requested (for manual saves)
        if (showVisualFeedback) {
          const originalText = saveWebsiteButton.textContent;
          saveWebsiteButton.textContent = "Saved!";
          saveWebsiteButton.style.backgroundColor = "#4caf50";
          
          setTimeout(() => {
            saveWebsiteButton.textContent = originalText;
            saveWebsiteButton.style.backgroundColor = "";
          }, 2000);
        }

        // Send message to background script to update content script registration
        chrome.runtime.sendMessage({
          type: "updateWebsiteUrl",
          websiteUrl: trimmedUrl
        });
      });
      
      return true;
    }
    
    // Add event listener for save button (manual save with feedback)
    saveWebsiteButton.addEventListener("click", function () {
      const websiteUrl = websiteUrlInput.value.trim();
      
      if (!websiteUrl) {
        alert("Please enter a website URL");
        return;
      }

      // Basic validation with alert feedback
      const subdomainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
      if (!subdomainRegex.test(websiteUrl)) {
        alert("Please enter a valid subdomain (e.g., 'textbook' for learning.textbook.com)");
        return;
      }
      
      // Use the helper function with visual feedback
      saveWebsiteUrlWithValidation(websiteUrl, true);
    });

    // Debounce helper for autosave
    let autosaveTimeout = null;
    
    // Autosave on input with debouncing (saves after user stops typing for 1 second)
    websiteUrlInput.addEventListener("input", function() {
      clearTimeout(autosaveTimeout);
      autosaveTimeout = setTimeout(() => {
        saveWebsiteUrlWithValidation(websiteUrlInput.value, false);
      }, 1000);
    });
    
    // Also save on Enter key press (immediate save with feedback)
    websiteUrlInput.addEventListener("keypress", function (event) {
      if (event.key === "Enter") {
        clearTimeout(autosaveTimeout); // Clear any pending autosave
        saveWebsiteButton.click();
      }
    });
  }

  /**
 * Initializes turbo mode checkbox and related functionality
 */
function initializeTurboMode() {
    // Guard clause: exit early if checkbox doesn't exist
    if (!turboModeCheckbox) {
      console.error("Turbo mode checkbox not found");
      return;
    }

    // Load current turbo mode state from storage
    chrome.storage.sync.get(["turboMode"], function (data) {
      const turboMode = data.turboMode || false;
      turboModeCheckbox.checked = turboMode;
      
      // Update delay inputs state based on turbo mode
      updateDelayInputsState(turboMode);
      
      // Save default value if it doesn't exist yet
      if (data.turboMode === undefined) {
        chrome.storage.sync.set({ turboMode: false });
      }
    });

    // Add event listener for turbo mode checkbox
    turboModeCheckbox.addEventListener("change", function () {
      const turboEnabled = turboModeCheckbox.checked;
      
      // Save turbo mode state to storage
      chrome.storage.sync.set({ turboMode: turboEnabled }, function () {
        if (chrome.runtime.lastError) {
          console.error("Error saving turbo mode setting:", chrome.runtime.lastError);
          return;
        }
        
        console.log("Turbo mode setting saved:", turboEnabled);
        
        // Update delay inputs state
        updateDelayInputsState(turboEnabled);
        
        // If turbo mode is enabled, override delays to 0
        if (turboEnabled) {
          const originalMinValue = minDelayInput.value;
          const originalMaxValue = maxDelayInput.value;
          
          // Store original values for restoration when turbo mode is disabled
          chrome.storage.sync.set({ 
            originalMinDelay: parseInt(originalMinValue) || 0,
            originalMaxDelay: parseInt(originalMaxValue) || 0,
            minDelay: 0,
            maxDelay: 0
          }, function () {
            minDelayInput.value = 0;
            maxDelayInput.value = 0;
          });
        } else {
          // Restore original delay values when turbo mode is disabled
          chrome.storage.sync.get(["originalMinDelay", "originalMaxDelay"], function (data) {
            const originalMin = data.originalMinDelay || 22;
            const originalMax = data.originalMaxDelay || 97;
            
            chrome.storage.sync.set({ 
              minDelay: originalMin,
              maxDelay: originalMax
            }, function () {
              minDelayInput.value = originalMin;
              maxDelayInput.value = originalMax;
            });
          });
        }
      });
    });
  }

  /**
 * Updates the visual state of delay inputs based on turbo mode setting
 * @param {boolean} turboEnabled - Whether turbo mode is enabled
 */
function updateDelayInputsState(turboEnabled) {
    // Exit early if inputs don't exist
    if (!minDelayInput || !maxDelayInput) return;
    
    // Re-enable delay inputs by default
    if (!turboEnabled) {
      minDelayInput.disabled = false;
      maxDelayInput.disabled = false;
      minDelayInput.style.opacity = "";
      maxDelayInput.style.opacity = "";
      minDelayInput.style.cursor = "";
      maxDelayInput.style.cursor = "";
      return;
    }
    
    // Disable delay inputs when turbo mode is enabled
    minDelayInput.disabled = true;
    maxDelayInput.disabled = true;
    minDelayInput.style.opacity = "0.5";
    maxDelayInput.style.opacity = "0.5";
    minDelayInput.style.cursor = "not-allowed";
    maxDelayInput.style.cursor = "not-allowed";
  }

  /**
   * Add visual enhancements - mouse position effects on cards
   */
  document.addEventListener("mousemove", function(e) {
    const cards = document.querySelectorAll('.settings-section');
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      card.style.setProperty('--mouse-x', x + 'px');
      card.style.setProperty('--mouse-y', y + 'px');
    });
  });
});
