const DEBUG = true;
function debug(...args) {
  if (DEBUG) console.log("[LRCInject bg]", ...args);
}

debug("Service worker loaded");

chrome.runtime.onInstalled.addListener(() => {
  debug("Extension installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AMX_INJECT_CONTENT_SCRIPT") {
    const tabId = message.tabId;
    if (!tabId) {
      sendResponse({ ok: false, error: "No tabId provided" });
      return true;
    }

    debug("Injecting content script into tab", tabId);

    Promise.all([
      chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ["content/content.css"],
      }),
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [
          "lib/runtime.js",
          "lib/utils.js",
          "lib/lrc-parser.js",
          "lib/srt-parser.js",
          "lib/json-parser.js",
          "lib/storage.js",
          "lib/media-bridge.js",
          "lib/track-detector.js",
          "lib/sync-engine.js",
          "lib/renderer.js",
          "content/content.js",
        ],
      }),
    ])
      .then(() => {
        debug("Content script and CSS injected successfully");
        sendResponse({ ok: true });
      })
      .catch((err) => {
        debug("Injection failed:", err.message);
        sendResponse({ ok: false, error: err.message });
      });

    return true;
  }

  return false;
});
