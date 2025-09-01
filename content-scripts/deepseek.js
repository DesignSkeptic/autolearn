/** @type {boolean} Flag indicating if a response has been processed */
let hasResponded = false;

/** @type {number} Number of messages present when question was asked */
let messageCountAtQuestion = 0;

/** @type {number} Timestamp when observation started */
let observationStartTime = 0;

/** @type {number|null} Timeout ID for observation timeout */
let observationTimeout = null;

/** @type {number|null} Interval ID for periodic response checking */
let checkIntervalId = null;

/** @type {MutationObserver|null} DOM observer for watching DeepSeek responses */
let observer = null;

/**
 * Listens for messages from the background script
 * @listens chrome.runtime.onMessage
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only process receiveQuestion messages
  if (message.type !== "receiveQuestion") return;
  
  resetObservation();

  const messages = document.querySelectorAll(
    "[data-testid='chat-message-assistant'], model-response, .ds-markdown"
  );
  messageCountAtQuestion = messages.length;
  hasResponded = false;

  insertQuestion(message.question)
    .then(() => {
      sendResponse({ received: true, status: "processing" });
    })
    .catch((error) => {
      sendResponse({ received: false, error: error.message });
    });

  // Return true to indicate we'll respond asynchronously
  return true;
});

/**
 * Resets the observation state by clearing any active observers and timers
 */
function resetObservation() {
  hasResponded = false;
  
  // Clear timeout if it exists
  if (observationTimeout) {
    clearTimeout(observationTimeout);
    observationTimeout = null;
  }
  
  // Clear interval if it exists
  if (checkIntervalId) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
  }
  
  // Disconnect observer if it exists
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

/**
 * Inserts a question into the DeepSeek input area and submits it
 * @param {Object} questionData - The question data from the education page
 * @param {string} questionData.type - The type of question (e.g., "multiple_choice")
 * @param {string} questionData.question - The question text
 * @param {Array|Object} [questionData.options] - The answer options if applicable
 * @param {Object} [questionData.previousCorrection] - Information about previous incorrect answer
 * @returns {Promise<void>} A promise that resolves when the question is submitted
 */
async function insertQuestion(questionData) {
  const { type, question, options, previousCorrection } = questionData;
  let text = `Type: ${type}\nQuestion: ${question}`;

  // Add correction information if available
  if (
    previousCorrection &&
    previousCorrection.question &&
    previousCorrection.correctAnswer
  ) {
    text =
      `CORRECTION FROM PREVIOUS ANSWER: For the question "${
        previousCorrection.question
      }", your answer was incorrect. The correct answer was: ${JSON.stringify(
        previousCorrection.correctAnswer
      )}\n\nNow answer this new question:\n\n` + text;
  }

  if (type === "matching") {
    text +=
      "\nPrompts:\n" +
      options.prompts.map((prompt, i) => `${i + 1}. ${prompt}`).join("\n");
    text +=
      "\nChoices:\n" +
      options.choices.map((choice, i) => `${i + 1}. ${choice}`).join("\n");
    text +=
      "\n\nPlease match each prompt with the correct choice. Format your answer as an array where each element is 'Prompt -> Choice'.";
  } else if (type === "fill_in_the_blank") {
    text +=
      "\n\nThis is a fill in the blank question. If there are multiple blanks, provide answers as an array in order of appearance. For a single blank, you can provide a string.";
  } else if (options && options.length > 0) {
    text +=
      "\nOptions:\n" + options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
    text +=
      "\n\nIMPORTANT: Your answer must EXACTLY match one of the above options. Do not include numbers in your answer. If there are periods, include them.";
  }

  text +=
    '\n\nPlease provide your answer in JSON format with keys "answer" and "explanation". Explanations should be no more than one sentence. DO NOT acknowledge the correction in your response, only answer the new question.';

  return new Promise((resolve, reject) => {
    const chatInput = document.getElementById("chat-input");
    
    if (!chatInput) {
      reject(new Error("Input area not found"));
      return;
    }
    
    setTimeout(() => {
      chatInput.focus();
      chatInput.value = text;
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));

      setTimeout(() => {
        const sendButtonSelectors = [
          '[role="button"].f6d670',
          ".f6d670",
          '[role="button"]:has(svg path[d^="M7 16c"])',
          'button[type="submit"]',
          '[aria-label="Send message"]',
          ".bf38813a button",
          "button:has(svg)",
          '[data-testid="send-button"]',
        ];

        let sendButton = null;
        for (const selector of sendButtonSelectors) {
          try {
            const button = document.querySelector(selector);
            if (button && !button.disabled) {
              sendButton = button;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!sendButton) {
          reject(new Error("Send button not found"));
          return;
        }
        
        sendButton.click();
        startObserving();
        resolve();
      }, 300);
    }, 300);
  });
}

/**
 * Processes a response from DeepSeek and sends it to the background script
 * @param {string} responseText - The raw text response from DeepSeek
 * @returns {boolean} Whether the response was successfully processed
 */
function processResponse(responseText) {
  // Clean and normalize the text
  const cleanedText = responseText
    .replace(/[\u200B-\u200D\uFEFF]/g, "")  // Remove zero-width characters
    .replace(/\n\s*/g, " ")                 // Replace newlines with spaces
    .trim();                                // Remove extra whitespace

  try {
    // Try to parse the response as JSON
    const parsed = JSON.parse(cleanedText);

    // Skip if not valid or already responded
    if (!parsed || !parsed.answer || hasResponded) {
      return false;
    }
    
    // Mark as responded to avoid duplicate processing
    hasResponded = true;
    
    // Send the response back to the background script
    chrome.runtime
      .sendMessage({
        type: "deepseekResponse",
        response: cleanedText,
      })
      .then(() => {
        resetObservation();
      })
      .catch((error) => {
        console.error("Error sending response:", error);
      });

    return true;
  } catch (e) {
    // Return false if JSON parsing failed
    return false;
  }
}

/**
 * Checks for new responses from DeepSeek
 * @returns {boolean} Whether a response was found and processed
 */
function checkForResponse() {
  // Skip if we've already processed a response
  if (hasResponded) return false;

  // Try different selectors to find messages (DeepSeek changes their UI often)
  const messageSelectors = [
    "[data-testid='chat-message-assistant']",
    "model-response",
    ".ds-markdown",
    ".f9bf7997",
  ];

  // Find messages using the first selector that returns results
  let messages = [];
  for (const selector of messageSelectors) {
    const foundMessages = document.querySelectorAll(selector);
    if (foundMessages.length > 0) {
      messages = Array.from(foundMessages);
      break;
    }
  }

  // Skip if no new messages since question was asked
  if (messages.length <= messageCountAtQuestion) return false;

  const newMessages = Array.from(messages).slice(messageCountAtQuestion);

  for (const message of newMessages) {
    const codeBlockSelectors = [
      ".md-code-block pre",
      "pre code",
      "pre",
      ".code-block pre",
      ".ds-markdown pre",
    ];

    for (const selector of codeBlockSelectors) {
      const codeBlocks = message.querySelectorAll(selector);

      for (const block of codeBlocks) {
        const parent = block.closest(
          ".md-code-block, .code-block, .ds-markdown"
        );

        if (!parent) continue;
        
        const infoElements = parent.querySelectorAll(
          '.d813de27, .md-code-block-infostring, [class*="json"], [class*="language"]'
        );
        const hasJsonInfo = Array.from(infoElements).some((el) =>
          el.textContent.toLowerCase().includes("json")
        );

        if (!hasJsonInfo && infoElements.length > 0) continue;
        
        const responseText = block.textContent.trim();
        if (
          responseText.includes("{") &&
          responseText.includes('"answer"')
        ) {
          if (processResponse(responseText)) return;
        }
      }
    }

    const messageText = message.textContent.trim();
    const jsonMatch = messageText.match(/\{[\s\S]*?"answer"[\s\S]*?\}/);
    if (jsonMatch) {
      const responseText = jsonMatch[0];
      if (processResponse(responseText)) return;
    }

    if (Date.now() - observationStartTime <= 30000) continue;
    
    try {
      const jsonPattern = /\{[\s\S]*?"answer"[\s\S]*?"explanation"[\s\S]*?\}/;
      const jsonMatch = messageText.match(jsonPattern);

      if (!jsonMatch || hasResponded) continue;
      
      hasResponded = true;
      chrome.runtime.sendMessage({
        type: "deepseekResponse",
        response: jsonMatch[0],
      });
      resetObservation();
      return true;
    } catch (e) {
      // Ignore parsing errors
    }
  }
}

/**
 * Starts observing the DOM for DeepSeek response changes
 */
function startObserving() {
  // Record start time for timing operations
  observationStartTime = Date.now();
  
  // Set a timeout to reset observation after 3 minutes if no response
  observationTimeout = setTimeout(() => {
    if (!hasResponded) {
      resetObservation();
    }
  }, 180000);

  // Create a mutation observer to watch for DeepSeek's response
  observer = new MutationObserver(() => {
    checkForResponse();
  });

  // Observe the entire document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });

  // Also set up an interval check (belt and suspenders approach)
  checkIntervalId = setInterval(checkForResponse, 1000);
}
