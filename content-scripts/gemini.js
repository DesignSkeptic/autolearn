/** @type {boolean} Flag indicating if a response has been processed */
let hasResponded = false;

/** @type {number} Number of messages present when question was asked */
let messageCountAtQuestion = 0;

/** @type {number} Timestamp when observation started */
let observationStartTime = 0;

/** @type {number|null} Timeout ID for observation timeout */
let observationTimeout = null;

/** @type {MutationObserver|null} DOM observer for watching Gemini responses */
let observer = null;

/**
 * Listens for messages from the background script
 * @listens chrome.runtime.onMessage
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only process receiveQuestion messages
  if (message.type !== "receiveQuestion") return;
  
  resetObservation();

  const messages = document.querySelectorAll("model-response");
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
 * Resets the observation state by clearing any active observers and timeouts
 */
function resetObservation() {
  hasResponded = false;
  
  // Clear observation timeout if it exists
  if (observationTimeout) {
    clearTimeout(observationTimeout);
    observationTimeout = null;
  }
  
  // Disconnect observer if it exists
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

/**
 * Inserts a question into the Gemini input area and submits it
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
    const inputArea = document.querySelector(".ql-editor");
    
    if (!inputArea) {
      reject(new Error("Input area not found"));
      return;
    }
    
    setTimeout(() => {
      inputArea.focus();
      inputArea.innerHTML = `<p>${text}</p>`;
      inputArea.dispatchEvent(new Event("input", { bubbles: true }));

      setTimeout(() => {
        const sendButton = document.querySelector(".send-button");
        
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
 * Starts observing the DOM for Gemini response changes
 */
function startObserving() {
  observationStartTime = Date.now();
  
  // Set a timeout to reset observation after 3 minutes if no response
  observationTimeout = setTimeout(() => {
    if (!hasResponded) {
      resetObservation();
    }
  }, 180000);

  // Create a mutation observer to watch for Gemini's response
  observer = new MutationObserver((mutations) => {
    // Exit if we've already processed a response
    if (hasResponded) return;

    // Get all model responses
    const messages = document.querySelectorAll("model-response");
    
    // Exit if no messages found
    if (!messages.length) return;
    
    // Exit if no new messages since question was asked
    if (messages.length <= messageCountAtQuestion) return;

    const latestMessage = messages[messages.length - 1];
    const codeBlocks = latestMessage.querySelectorAll("pre code");
    let responseText = "";

    for (const block of codeBlocks) {
      if (block.className.includes("hljs-") || block.closest(".code-block")) {
        responseText = block.textContent.trim();
        break;
      }
    }

    if (!responseText) {
      responseText = latestMessage.textContent.trim();
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) responseText = jsonMatch[0];
    }

    responseText = responseText
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\n\s*/g, " ")
      .trim();

    try {
      // Try to parse the response as JSON
      const parsed = JSON.parse(responseText);
      
      // If we have an answer and haven't responded yet
      if (parsed.answer && !hasResponded) {
        // Mark as responded to avoid duplicate processing
        hasResponded = true;
        
        // Send the response back to the background script
        chrome.runtime
          .sendMessage({
            type: "geminiResponse",
            response: responseText,
          })
          .then(() => {
            resetObservation();
          })
          .catch((error) => {
            console.error("Error sending response:", error);
          });
      }
      return;
    } catch (e) {
      // Continue to fallback logic if JSON parsing fails
    }
    
    // Check if Gemini is still generating a response
    const isGenerating =
      latestMessage.querySelector(".cursor") ||
      latestMessage.classList.contains("generating");

    // Exit if still generating or if we're within the first 30 seconds (partial response)
    if (isGenerating || Date.now() - observationStartTime <= 30000) return;
    
    // Fallback: try to extract JSON from the raw text response
    const responseText2 = latestMessage.textContent.trim();
    try {
      // Look for a JSON pattern with answer and explanation fields
      const jsonPattern = /\{[\s\S]*?"answer"[\s\S]*?"explanation"[\s\S]*?\}/;
      const jsonMatch = responseText2.match(jsonPattern);

      // If we found a JSON match and haven't responded yet
      if (jsonMatch && !hasResponded) {
        hasResponded = true;
        chrome.runtime.sendMessage({
          type: "geminiResponse",
          response: jsonMatch[0],
        });
        resetObservation();
      }
    } catch (e) {
      // Ignore parsing errors - no action needed
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
