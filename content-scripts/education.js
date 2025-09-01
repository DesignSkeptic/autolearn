/** @type {Function|null} Message listener for communication with background script */
let messageListener = null;

/** @type {boolean} Flag indicating if automation is currently running */
let isAutomating = false;

/** @type {string|null} The last question that was answered incorrectly */
let lastIncorrectQuestion = null;

/** @type {string|Array|null} The correct answer for the last incorrect question */
let lastCorrectAnswer = null;

/** @type {number|null} Timer ID for the countdown display */
let countdownTimer = null;

/** @type {HTMLElement|null} DOM element displaying the countdown */
let countdownElement = null;

/** @type {HTMLElement|null} DOM element for the skip delay button */
let skipButton = null;

/** @type {Function|null} Promise resolver for the current delay */
let currentDelayResolver = null;

/** @type {number|null} Timeout ID for the current delay */
let currentDelayTimeout = null;

/**
 * Generates a random delay between min and max seconds
 * @param {number} minSeconds - Minimum delay in seconds
 * @param {number} maxSeconds - Maximum delay in seconds
 * @returns {number} Random delay in milliseconds
 */
function generateRandomDelay(minSeconds, maxSeconds) {
  // If both values are 0, return 0 (no delay)
  if (minSeconds === 0 && maxSeconds === 0) {
    return 0;
  }
  
  // Ensure min is not greater than max
  if (minSeconds > maxSeconds) {
    minSeconds = maxSeconds;
  }
  
  const minDelay = minSeconds * 1000; // Convert to milliseconds
  const maxDelay = maxSeconds * 1000; // Convert to milliseconds
  
  // If both are still 0 after conversion, return 0
  if (minDelay === 0 && maxDelay === 0) {
    return 0;
  }
  
  return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}

/**
 * Formats seconds into MM:SS format
 * @param {number} seconds - Total seconds to format
 * @returns {string} Formatted time string
 */
function formatCountdown(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Updates the countdown display and control button visibility
 * @param {number} remainingSeconds - Seconds remaining
 */
function updateCountdownDisplay(remainingSeconds) {
  // Exit if countdown element doesn't exist
  if (!countdownElement) return;
  
  // Always show countdown and buttons when called (don't hide when time reaches 0)
  countdownElement.style.display = 'flex';
  countdownElement.textContent = `Answering In ${formatCountdown(remainingSeconds)}`;
  
  // Always show skip button when countdown is being updated
  if (!skipButton) return;
  
  skipButton.style.display = 'inline-block';
}

/**
 * Shows the control buttons without countdown display
 */
function showControlButtons() {
  if (!skipButton) return;
  
  skipButton.style.display = 'inline-block';
}

/**
 * Hides the control buttons
 */
function hideControlButtons() {
  if (!skipButton) return;
  
  skipButton.style.display = 'none';
}

/**
 * Clears the countdown timer and optionally hides the display
 * @param {boolean} hideDisplay - Whether to hide the display elements
 */
function clearCountdown(hideDisplay = true) {
  // Clear interval timer if it exists
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  
  // Clear timeout timer if it exists
  if (currentDelayTimeout) {
    clearTimeout(currentDelayTimeout);
    currentDelayTimeout = null;
  }
  
  // Skip hiding elements if not requested
  if (!hideDisplay) {
    // Clear the delay resolver and return
    currentDelayResolver = null;
    return;
  }
  
  // Hide countdown element if it exists
  if (countdownElement) {
    countdownElement.style.display = 'none';
  }
  
  // Hide control buttons
  hideControlButtons();
  
  // Clear the delay resolver
  currentDelayResolver = null;
}

/**
 * Skips the current delay and immediately processes the current question
 */
function skipCurrentDelay() {
  console.log("Skipping delay and processing question immediately");
  
  // Clear the countdown and timers but keep display
  clearCountdown(false);
  
  // Immediately process the current question by sending it to the chatbot
  const container = document.querySelector(".probe-container");
  if (!container || container.querySelector(".forced-learning")) return;
  
  const qData = parseQuestion();
  if (!qData) return;
  
  chrome.runtime.sendMessage({
    type: "sendQuestionToChatGPT",
    question: qData,
  });
}

/**
 * Applies random delay based on custom min/max settings
 * @returns {Promise<void>} Promise that resolves after delay (if any)
 */
async function applyRandomDelayIfEnabled() {
  return new Promise((resolve) => {
    // Store the resolver so it can be called from skipCurrentDelay
    currentDelayResolver = resolve;
    
    // Check if chrome.storage is available
    if (!chrome?.storage?.sync) {
      console.warn("Chrome storage not available, skipping delay");
      resolve();
      return;
    }

    chrome.storage.sync.get(["minDelay", "maxDelay"], (data) => {
      // Check for storage errors
      if (chrome.runtime.lastError) {
        console.warn("Error accessing storage for delay settings:", chrome.runtime.lastError);
        resolve();
        return;
      }

      const minDelay = data.minDelay !== undefined ? data.minDelay : 22;
      const maxDelay = data.maxDelay !== undefined ? data.maxDelay : 97;
      
      // If both delays are 0, send question immediately
      if (minDelay === 0 && maxDelay === 0) {
        clearCountdown();
        console.log("No delay configured (both min and max are 0), sending question immediately");
        
        sendQuestionIfReady();
        resolve();
        return;
      }

      // Clear any existing countdown first
      clearCountdown();
      
      const delay = generateRandomDelay(minDelay, maxDelay);
      
      // If generated delay is 0, send question immediately
      if (delay === 0) {
        console.log("Generated delay is 0, sending question immediately");
        sendQuestionIfReady();
        resolve();
        return;
      }
      
      setupDelayTimer(delay, resolve);
    });
  });

  function sendQuestionIfReady() {
    const container = document.querySelector(".probe-container");
    if (!container || container.querySelector(".forced-learning") || !isAutomating) return;
    
    const qData = parseQuestion();
    if (!qData) return;
    
    chrome.runtime.sendMessage({
      type: "sendQuestionToChatGPT",
      question: qData,
    });
  }

  function setupDelayTimer(delay, resolve) {
    console.log(`Applying random delay: ${delay}ms (${(delay / 1000).toFixed(1)}s)`);
    
    // Initialize countdown state
    let remainingSeconds = Math.ceil(delay / 1000);
    updateCountdownDisplay(remainingSeconds);
    
    // Update countdown every second
    countdownTimer = setInterval(() => {
      remainingSeconds -= 1;
      updateCountdownDisplay(remainingSeconds);
      
      // Clear timer when countdown reaches zero but keep display
      if (remainingSeconds <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        // Update display to show "Answering In 0:00" and keep buttons visible
        updateCountdownDisplay(0);
      }
    }, 1000);
    
    // Set timeout for the full delay - when this fires, send question to chatbot
    currentDelayTimeout = setTimeout(() => {
      const resolver = currentDelayResolver;
      
      // Clear timers but keep display showing
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      if (currentDelayTimeout) {
        clearTimeout(currentDelayTimeout);
        currentDelayTimeout = null;
      }
      
      // Clear the delay resolver
      currentDelayResolver = null;
      
      // Directly send question to chatbot when timer ends naturally
      sendQuestionIfReady();
      
      // Resolve the promise to continue with automation flow
      resolver();
    }, delay);
  }
}

/**
 * Sets up the message listener for communication with background script
 */
function setupMessageListener() {
  // Remove existing listener if it exists
  if (messageListener) {
    chrome.runtime.onMessage.removeListener(messageListener);
  }

  messageListener = (message, sender, sendResponse) => {
    // Handle ping messages for script activity verification
    if (message.type === "ping") {
      console.log("Content script received ping, responding");
      sendResponse({ received: true, status: "active" });
      return true;
    }
    
    // Handle chat responses from AI
    if (message.type === "processChatGPTResponse") {
      processChatGPTResponse(message.response);
      sendResponse({ received: true });
      return true;
    }

    // Handle alert messages
    if (message.type === "alertMessage") {
      alert(message.message);
      sendResponse({ received: true });
      return true;
    }
    
    // Default case - not handling this message
    return false;
  };

  chrome.runtime.onMessage.addListener(messageListener);
  
  // Notify background script that the content script is ready
  chrome.runtime.sendMessage({ 
    type: "contentScriptReady",
    url: window.location.href
  }).catch(error => {
    // It's okay if this fails, just log it
    console.log("Could not notify background script of initialization:", error);
  });
}

/**
 * Handles topic overview pages by clicking continue button
 * @returns {boolean} Whether a topic overview was handled
 */
function handleTopicOverview() {
  const continueButton = document.querySelector(
    "awd-topic-overview-button-bar .next-button, .button-bar-wrapper .next-button"
  );

  // Return early if button not found or doesn't contain "continue"
  if (!continueButton || !continueButton.textContent.trim().toLowerCase().includes("continue")) {
    return false;
  }

  continueButton.click();

  // Apply base delay before proceeding to next step
  setTimeout(() => {
    // Check if automation is still running after delay
    if (isAutomating) {
      checkForNextStep();
    }
  }, 1000);

  return true;
}

/**
 * Handles forced learning sections by navigating through reading flow
 * @returns {boolean} Whether a forced learning section was handled
 */
function handleForcedLearning() {
  const forcedLearningAlert = document.querySelector(
    ".forced-learning .alert-error"
  );
  
  // Return early if no forced learning alert
  if (!forcedLearningAlert) {
    return false;
  }

  const readButton = document.querySelector(
    '[data-automation-id="lr-tray_reading-button"]'
  );
  
  // Return early if no read button
  if (!readButton) {
    return false;
  }

  readButton.click();

  waitForElement('[data-automation-id="reading-questions-button"]', 10000)
    .then((toQuestionsButton) => {
      toQuestionsButton.click();
      return waitForElement(".next-button", 10000);
    })
    .then((nextButton) => {
      nextButton.click();
      
      // Apply base delay and check if automation is still running
      setTimeout(() => {
        // Check if automation is still running after delay
        if (isAutomating) {
          checkForNextStep();
        }
      }, 1000);
    })
    .catch((error) => {
      console.error("Error in forced learning flow:", error);
      isAutomating = false;
    });
  
  return true;
}

/**
 * Checks for the next step in the automation process
 * @returns {Promise<void>}
 */
async function checkForNextStep() {
  if (!isAutomating) return;

  if (handleTopicOverview()) return;
  if (handleForcedLearning()) return;

  const container = document.querySelector(".probe-container");
  if (!container || container.querySelector(".forced-learning")) return;
  
  // Apply delay before processing the question (including first question)
  // The delay completion will automatically send the question to the chatbot
  await applyRandomDelayIfEnabled();
  
  // Question sending is handled by the delay completion or skip button
  // No need to send again here to avoid duplication
}

/**
 * Extracts the correct answer from an incorrectly answered question
 * @returns {Object|null} Question data with correct answer, or null if not available
 */
function extractCorrectAnswer() {
  const container = document.querySelector(".probe-container");
  if (!container) return null;

  const incorrectMarker = container.querySelector(
    ".awd-probe-correctness.incorrect"
  );
  if (!incorrectMarker) return null;

  let questionType = "";
  if (container.querySelector(".awd-probe-type-multiple_choice")) {
    questionType = "multiple_choice";
  } else if (container.querySelector(".awd-probe-type-true_false")) {
    questionType = "true_false";
  } else if (container.querySelector(".awd-probe-type-multiple_select")) {
    questionType = "multiple_select";
  } else if (container.querySelector(".awd-probe-type-fill_in_the_blank")) {
    questionType = "fill_in_the_blank";
  } else if (container.querySelector(".awd-probe-type-matching")) {
    questionType = "matching";
  }

  let questionText = "";
  const promptEl = container.querySelector(".prompt");

  if (questionType === "fill_in_the_blank" && promptEl) {
    const promptClone = promptEl.cloneNode(true);

    const spans = promptClone.querySelectorAll(
      "span.response-container, span.fitb-span, span.blank-label, span.correctness, span._visuallyHidden"
    );
    spans.forEach((span) => span.remove());

    const inputs = promptClone.querySelectorAll("input.fitb-input");
    inputs.forEach((input) => {
      const blankMarker = document.createTextNode("[BLANK]");
      input.parentNode.replaceChild(blankMarker, input);
    });

    questionText = promptClone.textContent.trim();
  } else {
    questionText = promptEl ? promptEl.textContent.trim() : "";
  }

  let correctAnswer = null;

  if (questionType === "multiple_choice" || questionType === "true_false") {
    try {
      const answerContainer = container.querySelector(
        ".answer-container .choiceText"
      );
      
      if (answerContainer) {
        correctAnswer = answerContainer.textContent.trim();
      } else {
        const correctAnswerContainer = container.querySelector(
          ".correct-answer-container"
        );
        
        if (!correctAnswerContainer) {
          return null;
        }
        
        const answerText = correctAnswerContainer.querySelector(".choiceText");
        if (answerText) {
          correctAnswer = answerText.textContent.trim();
        } else {
          const answerDiv = correctAnswerContainer.querySelector(".choice");
          if (answerDiv) {
            correctAnswer = answerDiv.textContent.trim();
          }
        }
      }
    } catch (e) {
      console.error("Error extracting multiple choice answer:", e);
    }
  } else if (questionType === "multiple_select") {
    try {
      const correctAnswersList = container.querySelectorAll(
        ".correct-answer-container .choice"
      );
      
      if (!correctAnswersList || correctAnswersList.length === 0) {
        return null;
      }
      
      correctAnswer = Array.from(correctAnswersList).map((el) => {
        const choiceText = el.querySelector(".choiceText");
        return choiceText
          ? choiceText.textContent.trim()
          : el.textContent.trim();
      });
    } catch (e) {
      console.error("Error extracting multiple select answers:", e);
    }
  } else if (questionType === "fill_in_the_blank") {
    try {
      const correctAnswersList = container.querySelectorAll(".correct-answers");

      if (!correctAnswersList || correctAnswersList.length === 0) {
        return null;
      }
      
      if (correctAnswersList.length === 1) {
        const correctAnswerEl = correctAnswersList[0].querySelector(".correct-answer");
        
        if (correctAnswerEl) {
          correctAnswer = correctAnswerEl.textContent.trim();
        } else {
          const answerText = correctAnswersList[0].textContent.trim();
          if (answerText) {
            const match = answerText.match(/:\s*(.+)$/);
            correctAnswer = match ? match[1].trim() : answerText;
          }
        }
      } else {
        correctAnswer = Array.from(correctAnswersList).map((field) => {
          const correctAnswerEl = field.querySelector(".correct-answer");
          
          if (correctAnswerEl) {
            return correctAnswerEl.textContent.trim();
          }
          
          const answerText = field.textContent.trim();
          const match = answerText.match(/:\s*(.+)$/);
          return match ? match[1].trim() : answerText;
        });
      }
    } catch (e) {
      console.error("Error extracting fill in the blank answers:", e);
    }
  }

  if (questionType === "matching") {
    return null;
  }

  if (correctAnswer === null) {
    console.error("Failed to extract correct answer for", questionType);
    return null;
  }

  return {
    question: questionText,
    answer: correctAnswer,
    type: questionType,
  };
}

/**
 * Cleans an answer string by removing field prefixes and alternatives
 * @param {string|Array} answer - The answer to clean
 * @returns {string|Array} The cleaned answer
 */
function cleanAnswer(answer) {
  // Return null/undefined answers as-is
  if (!answer) return answer;

  // Handle array of answers
  if (Array.isArray(answer)) {
    return answer.map((item) => cleanAnswer(item));
  }

  // Return non-string answers as-is
  if (typeof answer !== "string") return answer;
  
  let cleanedAnswer = answer.trim();

  // Remove "Field X:" prefix
  cleanedAnswer = cleanedAnswer.replace(/^Field \d+:\s*/, "");

  // Take only the first option if there are alternatives
  if (cleanedAnswer.includes(" or ")) {
    cleanedAnswer = cleanedAnswer.split(" or ")[0].trim();
  }

  return cleanedAnswer;
}

/**
 * Processes the response from ChatGPT and applies it to the current question
 * @param {string} responseText - JSON string containing the ChatGPT response
 */
function processChatGPTResponse(responseText) {
  try {
    // Update countdown display to show "Answered" when returning from chatbot
    if (countdownElement && countdownElement.style.display !== 'none') {
      countdownElement.textContent = "Answered";
    }

    if (handleTopicOverview()) return;
    if (handleForcedLearning()) return;

    const response = JSON.parse(responseText);
    const answers = Array.isArray(response.answer)
      ? response.answer
      : [response.answer];

    const container = document.querySelector(".probe-container");
    if (!container) return;

    lastIncorrectQuestion = null;
    lastCorrectAnswer = null;

    // Handle matching question type
    if (container.querySelector(".awd-probe-type-matching")) {
      alert(
        "Matching Question Solution:\n\n" +
          answers.join("\n") +
          "\n\nPlease input these matches manually, then click high confidence and next."
      );
      return;
    }
    
    // Handle fill in the blank question type
    if (container.querySelector(".awd-probe-type-fill_in_the_blank")) {
      const inputs = container.querySelectorAll("input.fitb-input");
      inputs.forEach((input, index) => {
        if (answers[index]) {
          input.value = answers[index];
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      return;
    }
    
    // Handle multiple choice and checkbox questions
    const choices = container.querySelectorAll(
      'input[type="radio"], input[type="checkbox"]'
    );

    choices.forEach((choice) => {
      const label = choice.closest("label");
      if (!label) return;
      
      const choiceText = label
        .querySelector(".choiceText")
        ?.textContent.trim();
        
      if (!choiceText) return;
      
      const shouldBeSelected = answers.some((ans) => {
        // Exact match
        if (choiceText === ans) return true;

        // Match without trailing periods
        const choiceWithoutPeriod = choiceText.replace(/\.$/, "");
        const answerWithoutPeriod = ans.replace(/\.$/, "");
        if (choiceWithoutPeriod === answerWithoutPeriod) return true;

        // Match with added period
        if (choiceText === ans + ".") return true;

        return false;
      });

      if (shouldBeSelected) {
        choice.click();
      }
    });
    if (!isAutomating) return;
    
    waitForElement(
      '[data-automation-id="confidence-buttons--high_confidence"]:not([disabled])',
      10000
    )
      .then((button) => {
        button.click();

        setTimeout(() => {
          const incorrectMarker = container.querySelector(
            ".awd-probe-correctness.incorrect"
          );
          if (incorrectMarker) {
            const correctionData = extractCorrectAnswer();
            if (correctionData && correctionData.answer) {
              lastIncorrectQuestion = correctionData.question;
              lastCorrectAnswer = cleanAnswer(correctionData.answer);
              console.log(
                "Found incorrect answer. Correct answer is:",
                lastCorrectAnswer
              );
            }
          }

          waitForElement(".next-button", 10000)
            .then((nextButton) => {
              nextButton.click();
              
              setTimeout(() => {
                // Check if automation is still running after delay
                if (isAutomating) {
                  checkForNextStep();
                }
              }, 1000);
            })
            .catch((error) => {
              console.error("Automation error:", error);
              isAutomating = false;
            });
        }, 1000);
      })
      .catch((error) => {
        console.error("Automation error:", error);
        isAutomating = false;
      });
  } catch (e) {
    console.error("Error processing response:", e);
  }
}

/**
 * Adds the assistant button to the page header
 */
function addAssistantButton() {
  waitForElement("awd-header .header__navigation").then((headerNav) => {
    const buttonContainer = document.createElement("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.marginLeft = "10px";

    chrome.storage.sync.get("aiModel", function (data) {
      const aiModel = data.aiModel || "chatgpt";
      let modelName = "ChatGPT";

      if (aiModel === "gemini") {
        modelName = "Gemini";
      } else if (aiModel === "deepseek") {
        modelName = "DeepSeek";
      }

      const btn = document.createElement("button");
      btn.textContent = `Ask ${modelName}`;
      btn.classList.add("btn", "btn-secondary");
      btn.style.borderTopRightRadius = "0";
      btn.style.borderBottomRightRadius = "0";
      btn.addEventListener("click", () => {
        if (isAutomating) {
          isAutomating = false;
          clearCountdown();
          hideControlButtons();
          chrome.storage.sync.get("aiModel", function (data) {
            const currentModel = data.aiModel || "chatgpt";
            let currentModelName = "ChatGPT";

            if (currentModel === "gemini") {
              currentModelName = "Gemini";
            } else if (currentModel === "deepseek") {
              currentModelName = "DeepSeek";
            }

            btn.textContent = `Ask ${currentModelName}`;
          });
        } else {
          const proceed = confirm(
            "Start automated answering? Click OK to begin, or Cancel to stop."
          );
          if (!proceed) return;
          
          isAutomating = true;
          btn.textContent = "Stop Automation";
          checkForNextStep();
        }
      });

      const settingsBtn = document.createElement("button");
      settingsBtn.classList.add("btn", "btn-secondary");
      settingsBtn.style.borderTopLeftRadius = "0";
      settingsBtn.style.borderBottomLeftRadius = "0";
      settingsBtn.style.borderLeft = "1px solid rgba(0,0,0,0.2)";
      settingsBtn.style.padding = "6px 10px";
      settingsBtn.title = "AutoLearn Settings";
      settingsBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      `;
      settingsBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "openSettings" });
      });

      // Create countdown timer element (styled to match main buttons)
      countdownElement = document.createElement("span");
      countdownElement.classList.add("btn", "btn-secondary");
      countdownElement.style.display = "none";
      countdownElement.style.marginLeft = "10px";
      countdownElement.style.borderTopLeftRadius = "0.25rem";
      countdownElement.style.borderBottomLeftRadius = "0.25rem";
      countdownElement.style.borderTopRightRadius = "0";
      countdownElement.style.borderBottomRightRadius = "0";
      countdownElement.style.cursor = "default";
      countdownElement.style.whiteSpace = "nowrap";
      countdownElement.style.alignItems = "center";
      countdownElement.style.justifyContent = "center";

      // Create skip button element (styled to match main buttons)
      skipButton = document.createElement("button");
      skipButton.textContent = "Skip Timer";
      skipButton.classList.add("btn", "btn-success");
      skipButton.style.display = "none";
      skipButton.style.borderTopLeftRadius = "0";
      skipButton.style.borderBottomLeftRadius = "0";
      skipButton.title = "Skip delay and send question to AI immediately";
      
      // Add click handler for skip button
      skipButton.addEventListener("click", skipCurrentDelay);

      buttonContainer.appendChild(btn);
      buttonContainer.appendChild(settingsBtn);
      buttonContainer.appendChild(countdownElement);
      buttonContainer.appendChild(skipButton);
      headerNav.appendChild(buttonContainer);

      chrome.storage.onChanged.addListener((changes) => {
        if (changes.aiModel) {
          const newModel = changes.aiModel.newValue;
          let newModelName = "ChatGPT";

          if (newModel === "gemini") {
            newModelName = "Gemini";
          } else if (newModel === "deepseek") {
            newModelName = "DeepSeek";
          }

          if (!isAutomating) {
            btn.textContent = `Ask ${newModelName}`;
            clearCountdown();
            hideControlButtons();
          }
        }
      });
    });
  });
}

/**
 * Parses the current question from the page
 * @returns {Object|null} Question data or null if not found
 */
function parseQuestion() {
  const container = document.querySelector(".probe-container");
  if (!container) {
    alert("No question found on the page.");
    return null;
  }

  let questionType = "";
  if (container.querySelector(".awd-probe-type-multiple_choice")) {
    questionType = "multiple_choice";
  } else if (container.querySelector(".awd-probe-type-true_false")) {
    questionType = "true_false";
  } else if (container.querySelector(".awd-probe-type-multiple_select")) {
    questionType = "multiple_select";
  } else if (container.querySelector(".awd-probe-type-fill_in_the_blank")) {
    questionType = "fill_in_the_blank";
  } else if (container.querySelector(".awd-probe-type-matching")) {
    questionType = "matching";
  }

  let questionText = "";
  const promptEl = container.querySelector(".prompt");

  if (questionType === "fill_in_the_blank" && promptEl) {
    const promptClone = promptEl.cloneNode(true);

    const uiSpans = promptClone.querySelectorAll(
      "span.fitb-span, span.blank-label, span.correctness, span._visuallyHidden"
    );
    uiSpans.forEach((span) => span.remove());

    const inputs = promptClone.querySelectorAll("input.fitb-input");
    inputs.forEach((input) => {
      const blankMarker = document.createTextNode("[BLANK]");
      if (input.parentNode) {
        input.parentNode.replaceChild(blankMarker, input);
      }
    });

    questionText = promptClone.textContent.trim();
  } else {
    questionText = promptEl ? promptEl.textContent.trim() : "";
  }

  let options = [];
  if (questionType === "matching") {
    const prompts = Array.from(
      container.querySelectorAll(".match-prompt .content")
    ).map((el) => el.textContent.trim());
    const choices = Array.from(
      container.querySelectorAll(".choices-container .content")
    ).map((el) => el.textContent.trim());
    options = { prompts, choices };
  } else if (questionType !== "fill_in_the_blank") {
    container.querySelectorAll(".choiceText").forEach((el) => {
      options.push(el.textContent.trim());
    });
  }

  return {
    type: questionType,
    question: questionText,
    options: options,
    previousCorrection: lastIncorrectQuestion
      ? {
          question: lastIncorrectQuestion,
          correctAnswer: lastCorrectAnswer,
        }
      : null,
  };
}

/**
 * Waits for an element to appear in the DOM
 * @param {string} selector - CSS selector to wait for
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Promise<Element>} Promise resolving to the found element
 */
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearInterval(interval);
        resolve(el);
        return;
      }
      
      if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error("Element not found: " + selector));
      }
    }, 100);
  });
}

setupMessageListener();
addAssistantButton();

// Clean up countdown timer when page unloads
window.addEventListener('beforeunload', () => {
  clearCountdown();
});

if (isAutomating) {
  setTimeout(() => {
    checkForNextStep();
  }, 1000);
}
