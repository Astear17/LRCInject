(function () {
  const DEBUG = true;
  function debug(...args) {
    if (DEBUG) console.log("[LRCInject popup]", ...args);
  }

  var statusEl, trackInfoEl, trackTitleEl, trackArtistEl, playbackStateEl;
  var noTrackEl, actionsEl, importBtn, fileInput, toggleBtn, removeBtn;
  var lyricsStatusEl, lyricsLineCountEl, offsetControlEl, offsetValueEl;
  var offsetMinus, offsetPlus, offsetMinus5, offsetPlus5;
  var useCustomCheck, debugCheck, retryBtn, retryArea, controlsRow;

  function cacheElements() {
    statusEl = document.getElementById("status");
    trackInfoEl = document.getElementById("trackInfo");
    trackTitleEl = document.getElementById("trackTitle");
    trackArtistEl = document.getElementById("trackArtist");
    playbackStateEl = document.getElementById("playbackState");
    noTrackEl = document.getElementById("noTrack");
    actionsEl = document.getElementById("actions");
    importBtn = document.getElementById("importBtn");
    fileInput = document.getElementById("fileInput");
    toggleBtn = document.getElementById("toggleBtn");
    removeBtn = document.getElementById("removeBtn");
    lyricsStatusEl = document.getElementById("lyricsStatus");
    lyricsLineCountEl = document.getElementById("lyricsLineCount");
    offsetControlEl = document.getElementById("offsetControl");
    offsetValueEl = document.getElementById("offsetValue");
    offsetMinus = document.getElementById("offsetMinus");
    offsetPlus = document.getElementById("offsetPlus");
    offsetMinus5 = document.getElementById("offsetMinus5");
    offsetPlus5 = document.getElementById("offsetPlus5");
    useCustomCheck = document.getElementById("useCustomCheck");
    debugCheck = document.getElementById("debugCheck");
    retryBtn = document.getElementById("retryBtn");
    retryArea = document.getElementById("retryArea");
    controlsRow = document.getElementById("controlsRow");
  }

  var activeTab = null;
  var currentOffset = 0;

  function setStatus(text, cls) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = "status";
    if (cls) statusEl.classList.add(cls);
  }

  function sendToContent(message) {
    return new Promise(function (resolve, reject) {
      if (!activeTab) {
        reject(new Error("No active tab"));
        return;
      }
      chrome.tabs.sendMessage(activeTab.id, message, function (response) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  function injectContentScript() {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { type: "AMX_INJECT_CONTENT_SCRIPT", tabId: activeTab.id },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          if (response && response.ok) {
            resolve(response);
          } else {
            reject(new Error(response ? response.error : "Injection failed"));
          }
        }
      );
    });
  }

  function formatTime(s) {
    if (!s || isNaN(s) || !isFinite(s) || s < 0) return "0:00";
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function formatOffset(v) {
    var sign = v >= 0 ? "+" : "";
    return sign + v.toFixed(2) + "s";
  }

  function showSection(section) {
    if (section) section.style.display = "";
  }

  function hideSection(section) {
    if (section) section.style.display = "none";
  }

  async function establishConnection() {
    setStatus("Connecting...", "connecting");
    hideSection(noTrackEl);
    hideSection(actionsEl);
    hideSection(trackInfoEl);
    hideSection(retryArea);

    try {
      var tabs = await new Promise(function (r) {
        chrome.tabs.query({ active: true, currentWindow: true }, r);
      });

      if (!tabs || !tabs[0]) {
        setStatus("No active tab", "error");
        showNoAppleMusic();
        return;
      }

      activeTab = tabs[0];
      debug("Active tab:", activeTab.url);

      if (!activeTab.url || !activeTab.url.includes("music.apple.com")) {
        setStatus("Not on Apple Music", "");
        showNoAppleMusic();
        return;
      }

      try {
        await sendToContent({ type: "AMX_PING" });
        onConnected();
      } catch (err) {
        debug("Ping failed:", err.message);

        if (
          err.message &&
          err.message.includes("Receiving end does not exist")
        ) {
          setStatus("Injecting...", "connecting");

          try {
            await injectContentScript();
            await new Promise(function (r) {
              setTimeout(r, 600);
            });
            await sendToContent({ type: "AMX_PING" });
            onConnected();
          } catch (injErr) {
            debug("Injection failed:", injErr.message);
            setStatus("Error", "error");
            showError(
              "Content script injection failed. Reload the Apple Music page."
            );
          }
        } else {
          setStatus("Error", "error");
          showError("Connection failed: " + err.message);
        }
      }
    } catch (err) {
      setStatus("Error", "error");
      showError("Unexpected error: " + err.message);
    }
  }

  function onConnected() {
    debug("Connected to content script");
    hideSection(noTrackEl);
    hideSection(retryArea);
    fetchPlayerState();
    fetchLyricsState();
  }

  function fetchPlayerState() {
    sendToContent({ type: "AMX_GET_PLAYER_STATE" })
      .then(function (resp) {
        if (!resp || !resp.ok || !resp.state) {
          setStatus("Connected", "connected");
          return;
        }

        var s = resp.state;
        debug(
          "Player state:",
          s.title || "(no title)",
          s.paused ? "paused" : "playing",
          "hasAudio:",
          s.hasAudio
        );

        if (s.hasAudio) {
          setStatus(
            s.paused ? "Connected, paused" : "Connected, playing",
            "connected"
          );
        } else {
          setStatus("Connected, no audio", "connected");
        }

        if (s.title || s.artist) {
          showSection(trackInfoEl);
          trackTitleEl.textContent = s.title || "Unknown Title";
          trackArtistEl.textContent = s.artist || "Unknown Artist";
          if (playbackStateEl) {
            playbackStateEl.textContent =
              formatTime(s.currentTime) + " / " + formatTime(s.duration);
          }
          showSection(actionsEl);
          hideSection(noTrackEl);
        } else if (s.hasAudio) {
          hideSection(trackInfoEl);
          showSection(actionsEl);
          showSection(noTrackEl);
          noTrackEl.querySelector("p").innerHTML =
            "Audio detected. Import lyrics for the current song.";
        } else {
          hideSection(trackInfoEl);
          hideSection(actionsEl);
          showSection(noTrackEl);
          noTrackEl.querySelector("p").innerHTML =
            "Connected. <strong>Play a song</strong> to manage lyrics.";
        }
      })
      .catch(function (err) {
        debug("Failed to get player state:", err.message);
        setStatus("Connected", "connected");
        showSection(actionsEl);
      });
  }

  function fetchLyricsState() {
    sendToContent({ type: "AMX_GET_LYRICS_STATE" })
      .then(function (resp) {
        if (!resp || !resp.ok) return;

        if (resp.hasBinding && resp.binding) {
          showSection(lyricsStatusEl);
          lyricsLineCountEl.textContent = resp.binding.parsedLines
            ? resp.binding.parsedLines.length
            : 0;
          showSection(removeBtn);
          showSection(offsetControlEl);
          showSection(controlsRow);
          currentOffset = resp.binding.userOffset || 0;
          offsetValueEl.textContent = formatOffset(currentOffset);
        } else {
          hideSection(lyricsStatusEl);
          hideSection(removeBtn);
          hideSection(offsetControlEl);
          hideSection(controlsRow);
        }

        if (resp.settings) {
          useCustomCheck.checked = !!resp.settings.useCustomOverNative;
        }
      })
      .catch(function (err) {
        debug("Failed to get lyrics state:", err.message);
      });
  }

  function showNoAppleMusic() {
    showSection(noTrackEl);
    noTrackEl.querySelector("p").innerHTML =
      "Navigate to <strong>music.apple.com</strong> to use LRCInject.";
    hideSection(actionsEl);
    hideSection(trackInfoEl);
  }

  function showError(msg) {
    showSection(noTrackEl);
    noTrackEl.querySelector("p").innerHTML = msg;
    hideSection(actionsEl);
    hideSection(trackInfoEl);
    showSection(retryArea);
  }

  function updateOffset(delta) {
    currentOffset = Math.round((currentOffset + delta) * 100) / 100;
    currentOffset = Math.max(-2, Math.min(2, currentOffset));
    offsetValueEl.textContent = formatOffset(currentOffset);
    sendToContent({ type: "AMX_SET_OFFSET", offset: currentOffset }).catch(
      function () {}
    );
  }

  function init() {
    cacheElements();

    importBtn.addEventListener("click", function () {
      fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;

      var ext = file.name.split(".").pop().toLowerCase();
      var sourceType;
      if (ext === "lrc") sourceType = "lrc";
      else if (ext === "srt") sourceType = "srt";
      else if (ext === "json") sourceType = "json";
      else {
        alert("Unsupported file. Use .lrc, .srt, or .json");
        return;
      }

      var reader = new FileReader();
      reader.onload = function (ev) {
        var content = ev.target.result;
        debug("File read:", file.name, content.length, "chars");

        setStatus("Importing...", "connecting");

        sendToContent({
          type: "AMX_IMPORT_LYRICS",
          content: content,
          sourceType: sourceType,
          filename: file.name,
        })
          .then(function (resp) {
            debug("Import response:", resp);
            if (resp && resp.ok) {
              setStatus("Imported " + resp.lineCount + " lines", "connected");
              fetchLyricsState();
            } else {
              alert(resp ? resp.error : "Import failed");
              setStatus("Connected", "connected");
            }
          })
          .catch(function (err) {
            alert("Import error: " + err.message);
            setStatus("Connected", "connected");
          });
      };
      reader.readAsText(file);
      fileInput.value = "";
    });

    toggleBtn.addEventListener("click", function () {
      sendToContent({ type: "LRCINJECT_TOGGLE_OVERLAY" })
        .then(function (resp) {
          debug("Toggle result:", resp);
        })
        .catch(function (err) {
          debug("Toggle error:", err.message);
        });
    });

    removeBtn.addEventListener("click", function () {
      if (!confirm("Remove lyrics for this song?")) return;
      sendToContent({ type: "AMX_REMOVE_LYRICS" })
        .then(function () {
          fetchLyricsState();
        })
        .catch(function () {});
    });

    offsetMinus5.addEventListener("click", function () {
      updateOffset(-0.5);
    });
    offsetMinus.addEventListener("click", function () {
      updateOffset(-0.1);
    });
    offsetPlus.addEventListener("click", function () {
      updateOffset(0.1);
    });
    offsetPlus5.addEventListener("click", function () {
      updateOffset(0.5);
    });

    useCustomCheck.addEventListener("change", function () {
      sendToContent({
        type: "AMX_SET_USE_CUSTOM",
        value: useCustomCheck.checked,
      }).catch(function () {});
    });

    debugCheck.addEventListener("change", function () {
      sendToContent({ type: "AMX_DEBUG_TOGGLE" }).catch(function () {});
    });

    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        hideSection(retryArea);
        establishConnection();
      });
    }

    establishConnection();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
