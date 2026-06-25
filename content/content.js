(() => {
  const INSTANCE_KEY = "__LRCINJECT_CONTENT_INSTANCE__";

  if (window[INSTANCE_KEY]?.cleanup) {
    try {
      window[INSTANCE_KEY].cleanup();
    } catch {}
  }

  const instance = { version: "1.0.0", cleanup: () => {} };
  window[INSTANCE_KEY] = instance;

  const DEBUG = true;
  const USE_CUSTOM_BACKGROUND = false;
  function debug(...args) {
    if (DEBUG) console.log("[LRCInject]", ...args);
  }

  var _currentTrackKey = null;
  var _currentBinding = null;
  var _observer = null;
  var _settings = null;
  var _heartbeatInterval = null;
  var _initialized = false;
  var _cachedState = null;
  var _routeChangeHandlerInstalled = false;
  var _stopped = false;

  function clamp01(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  var ENHANCED_LRC_TAG_RE = /<\d{1,2}:[0-5]\d(?:[.:]\d{1,3})?>/g;

  function stripEnhancedLrcTags(text) {
    return String(text == null ? "" : text).replace(ENHANCED_LRC_TAG_RE, "");
  }

  var _playerRoot = null;
  var _lastTimelineState = null;

  var overlayState = {
    visible: false,
    binding: null,
    renderedTrackKey: null,
    activeRenderIndex: -1,
    renderItems: null,
    raf: null,
  };

  function cleanup() {
    _stopped = true;
    try { stopSyncLoop(); } catch {}
    try { removeLayoutMode(); } catch {}
    try { if (_observer) _observer.disconnect(); } catch {}
    try { if (_heartbeatInterval) clearInterval(_heartbeatInterval); } catch {}
    try { window.removeEventListener("message", AMX.MediaBridge._onMessage); } catch {}
    try { AMX.MediaBridge.destroy(); } catch {}
    try { AMX.SyncEngine.stop(); } catch {}
    debug("cleaned up content script instance");
  }

  instance.cleanup = cleanup;

  function isVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    var style = getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function findLargestSquareImage() {
    var images = Array.from(document.querySelectorAll("img")).filter(isVisible);

    var scored = [];
    for (var i = 0; i < images.length; i++) {
      var r = images[i].getBoundingClientRect();
      var ratio = r.width / r.height;
      if (r.width > 180 && r.height > 180 && ratio > 0.7 && ratio < 1.4) {
        scored.push({ img: images[i], area: r.width * r.height });
      }
    }

    scored.sort(function (a, b) { return b.area - a.area; });
    return scored.length > 0 ? scored[0].img : null;
  }

  function findFullscreenPlayerContainer() {
    if (_playerRoot && document.contains(_playerRoot)) return _playerRoot;

    var artwork = findLargestSquareImage();
    if (!artwork) {
      debug("findFullscreenPlayerContainer: no large square image found");
      return null;
    }

    debug("findFullscreenPlayerContainer: found artwork image", artwork.src.substring(0, 80));
    var artRect = artwork.getBoundingClientRect();
    debug("findFullscreenPlayerContainer: artwork rect", JSON.stringify({ x: artRect.x, y: artRect.y, w: artRect.width, h: artRect.height }));

    var node = artwork.parentElement;
    var best = null;

    while (node && node !== document.body && node !== document.documentElement) {
      var rect = node.getBoundingClientRect();

      var reasonableWidth = rect.width >= artRect.width * 0.8;
      var notWholePage = rect.width < window.innerWidth * 0.70 && rect.height < window.innerHeight * 0.95;
      var notBody = node !== document.body && node !== document.documentElement;
      var isVisible = rect.width > 0 && rect.height > 0;
      var containsButtons = node.querySelector("button") || node.querySelector('[role="button"]') || node.querySelector('[data-testid*="play"]');

      if (reasonableWidth && notWholePage && notBody && isVisible && containsButtons) {
        best = node;
      }

      node = node.parentElement;
    }

    if (best) {
      var bestRect = best.getBoundingClientRect();
      debug("findFullscreenPlayerContainer: found player root", best.tagName, best.className.substring(0, 80));
      debug("findFullscreenPlayerContainer: player root rect", JSON.stringify({ x: bestRect.x, y: bestRect.y, w: bestRect.width, h: bestRect.height }));
      _playerRoot = best;
    } else {
      debug("findFullscreenPlayerContainer: no suitable container found");
      _playerRoot = null;
    }

    return _playerRoot;
  }

  function rectsOverlap(a, b) {
    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  }

  function verifyNoOverlap() {
    var player = document.querySelector('[data-lrcinject-player-root="true"]');
    var panel = document.querySelector("#lrcinject-overlay .lrcinject-lyrics-panel");
    if (!player || !panel) return true;

    var playerRect = player.getBoundingClientRect();
    var panelRect = panel.getBoundingClientRect();
    var overlap = rectsOverlap(playerRect, panelRect);

    debug("verifyNoOverlap", JSON.stringify({
      overlap: overlap,
      player: { left: Math.round(playerRect.left), right: Math.round(playerRect.right), top: Math.round(playerRect.top), bottom: Math.round(playerRect.bottom) },
      panel: { left: Math.round(panelRect.left), right: Math.round(panelRect.right), top: Math.round(panelRect.top), bottom: Math.round(panelRect.bottom) }
    }));

    return !overlap;
  }

  function applyLayoutMode() {
    try {
      var playerRoot = findFullscreenPlayerContainer();

      if (!playerRoot) {
        debug("[LRCInject] player root not found");
        return;
      }

      playerRoot.setAttribute("data-lrcinject-player-root", "true");
      document.documentElement.classList.add("lrcinject-layout-active");

      debug("layout active, player root", playerRoot.tagName);

      requestAnimationFrame(function () {
        verifyNoOverlap();
      });
    } catch (e) {
      debug("applyLayoutMode failed:", e);
    }
  }

  function removeLayoutMode() {
    try {
      document.documentElement.classList.remove("lrcinject-layout-active");

      var shifted = document.querySelector('[data-lrcinject-player-root="true"]');
      if (shifted) {
        shifted.removeAttribute("data-lrcinject-player-root");
        shifted.style.removeProperty("transform");
      }

      if (_playerRoot) {
        _playerRoot.removeAttribute("data-lrcinject-player-root");
        _playerRoot.style.removeProperty("transform");
      }

      debug("layout mode removed");
    } catch (e) {
      debug("removeLayoutMode failed:", e);
    }
  }

  function getActiveAudio() {
    var audios = Array.from(document.querySelectorAll("audio"));
    return (
      audios.find(function (a) { return !a.paused || a.currentTime > 0; }) ||
      audios[0] ||
      null
    );
  }

  function getPlayerState() {
    var audio = getActiveAudio();
    var state = {
      connected: true,
      hasAudio: !!audio,
      currentTime: audio ? audio.currentTime : 0,
      duration: audio ? (isFinite(audio.duration) ? audio.duration : 0) : 0,
      paused: audio ? audio.paused : true,
      url: location.href,
      title: "",
      artist: "",
      album: "",
      artworkUrl: "",
    };

    var bridgeState = null;
    try {
      bridgeState = typeof AMX !== "undefined" && AMX.MediaBridge
        ? AMX.MediaBridge.getState()
        : null;
    } catch (e) {}

    if (bridgeState) {
      if (bridgeState.title) state.title = bridgeState.title;
      if (bridgeState.artist) state.artist = bridgeState.artist;
      if (bridgeState.album) state.album = bridgeState.album;
      if (bridgeState.artworkUrl) state.artworkUrl = bridgeState.artworkUrl;
      if (bridgeState.currentTime > 0) state.currentTime = bridgeState.currentTime;
      if (bridgeState.duration > 0 && isFinite(bridgeState.duration)) state.duration = bridgeState.duration;
      if (typeof bridgeState.paused === "boolean") state.paused = bridgeState.paused;
    }

    if (!state.title) {
      var titleEl =
        document.querySelector('[data-testid="track-title"]') ||
        document.querySelector('[data-testid="product-title"]') ||
        document.querySelector(".typography-title") ||
        document.querySelector('[class*="song-name"]') ||
        document.querySelector('[class*="track-name"]');
      if (titleEl) state.title = titleEl.textContent.trim();
    }
    if (!state.artist) {
      var artistEl =
        document.querySelector('[data-testid="track-artist"]') ||
        document.querySelector('[data-testid="product-subtitle"]') ||
        document.querySelector(".typography-caption") ||
        document.querySelector('[class*="artist-name"]') ||
        document.querySelector('[class*="song-subtitle"]');
      if (artistEl) state.artist = artistEl.textContent.trim();
    }

    if (!state.title) {
      var dt = document.title;
      if (dt && dt !== "Apple Music") {
        var parts = dt.split(" \u2014 ");
        if (parts.length < 2) parts = dt.split(" - ");
        if (parts.length >= 2) {
          state.title = parts[0].trim();
          state.artist = parts[1].trim();
        } else {
          state.title = dt.trim();
        }
      }
    }

    var track = null;
    try {
      track = typeof AMX !== "undefined" && AMX.TrackDetector
        ? AMX.TrackDetector.getCurrentTrack()
        : null;
    } catch (e) {}

    if (track) {
      state.trackKey = track.key;
      if (!state.title && track.title) state.title = track.title;
      if (!state.artist && track.artist) state.artist = track.artist;
    }

    if (_currentBinding) {
      state.hasBinding = true;
      state.bindingId = _currentBinding.id;
      state.lineCount = _currentBinding.parsedLines ? _currentBinding.parsedLines.length : 0;
      state.userOffset = _currentBinding.userOffset || 0;
    } else {
      state.hasBinding = false;
    }

    return state;
  }

  function makeTrackKeyFromState(state) {
    if (state.trackKey) return state.trackKey;
    return AMX.makeTrackKey(state.title, state.artist, state.duration);
  }

  function updateHeartbeat() {
    if (_stopped) return;
    _cachedState = getPlayerState();
  }

  function showToast(text) {
    var toast = document.createElement("div");
    toast.className = "lrcinject-toast";
    toast.textContent = text;
    toast.style.cssText =
      "position:fixed;top:40px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:rgba(0,0,0,0.85);color:#fff;padding:12px 24px;border-radius:10px;" +
      "font-size:15px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;" +
      "pointer-events:none;opacity:0;transition:opacity 300ms ease;";
    document.documentElement.appendChild(toast);
    requestAnimationFrame(function () { toast.style.opacity = "1"; });
    setTimeout(function () {
      toast.style.opacity = "0";
      setTimeout(function () { toast.remove(); }, 400);
    }, 2500);
  }

  function getAppleMusicTypographySource() {
    return (
      document.querySelector("amp-lyrics-display-synced-line .line") ||
      document.querySelector('[data-testid="lyrics-lyrics"]') ||
      document.querySelector('[data-testid="track-title"]') ||
      document.querySelector(".typography-title") ||
      document.querySelector("h1, h2") ||
      document.body
    );
  }

  function applyInheritedTypography() {
    var source = getAppleMusicTypographySource();
    var overlay = document.querySelector("#lrcinject-overlay");
    if (!source || !overlay) return;

    var style = getComputedStyle(source);

    overlay.style.setProperty("--lrcinject-font-family", style.fontFamily || "inherit");
    overlay.style.setProperty("--lrcinject-font-weight", style.fontWeight || "700");
    overlay.style.setProperty("--lrcinject-letter-spacing", style.letterSpacing || "normal");

    debug("typography synced from", source.tagName, source.className?.substring(0, 40));
  }

  function ensureOverlay() {
    var overlay = document.getElementById("lrcinject-overlay");
    if (overlay) return overlay;

    debug("creating overlay");

    overlay = document.createElement("div");
    overlay.id = "lrcinject-overlay";

    var innerHtml = "";
    if (USE_CUSTOM_BACKGROUND) {
      innerHtml +=
        '<div class="lrcinject-blend-main" aria-hidden="true"></div>' +
        '<div class="lrcinject-blend-feather" aria-hidden="true"></div>';
    }
    innerHtml +=
      '<button class="lrcinject-close" aria-label="Close lyrics">\u00d7</button>' +
      '<div class="lrcinject-lyrics-panel">' +
        '<div class="lrcinject-lines" id="lrcinject-lines"></div>' +
      '</div>';

    overlay.innerHTML = innerHtml;

    document.documentElement.appendChild(overlay);

    var closeBtn = overlay.querySelector(".lrcinject-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        setOverlayVisible(false);
      });
    }

    var panel = overlay.querySelector(".lrcinject-lyrics-panel");
    if (panel) {
      panel.addEventListener("click", handleLyricLineClick);
      panel.addEventListener("keydown", handleLyricLineKeydown);
    }

    debug("overlay appended");

    return overlay;
  }

  function handleLyricLineClick(event) {
    var target = event.target.closest(".lrcinject-line");
    if (!target) return;

    var start = Number(target.getAttribute("data-start"));
    if (!Number.isFinite(start)) return;

    var audio = getActiveAudio();
    if (!audio) return;

    audio.currentTime = Math.max(0, start);

    var renderIdx = Number(target.getAttribute("data-render-index"));
    if (Number.isFinite(renderIdx)) {
      overlayState.activeRenderIndex = renderIdx;
      var offset = overlayState.binding ? (overlayState.binding.userOffset || 0) : 0;
      updateActiveClasses(renderIdx, audio.currentTime, offset);
      scrollToActiveRenderItem(renderIdx);
    }
  }

  function handleLyricLineKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleLyricLineClick(event);
    }
  }

  function getLyricsPlaybackState(lines, currentTime, offset, trackDuration) {
    if (!Array.isArray(lines) || lines.length === 0) return "empty";

    var t = currentTime + (offset || 0);
    var first = lines[0];
    var last = lines[lines.length - 1];
    var lastEnd = Number.isFinite(last.end)
      ? last.end
      : (Number.isFinite(trackDuration) && trackDuration > 0
        ? trackDuration
        : last.start + 15);

    if (t < first.start) return "before-start";
    if (t > lastEnd) return "after-end";
    return "active";
  }

  function getOrCreatePrerollIndicator() {
    var el = document.getElementById("lrcinject-preroll");
    if (el) return el;
    el = document.createElement("div");
    el.id = "lrcinject-preroll";
    el.className = "lrcinject-preroll-indicator";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = "<span></span><span></span><span></span>";
    return el;
  }

  function showPrerollIndicator() {
    var linesContainer = document.getElementById("lrcinject-lines");
    if (!linesContainer) return;
    var indicator = getOrCreatePrerollIndicator();
    if (!indicator.parentNode) {
      linesContainer.insertBefore(indicator, linesContainer.firstChild);
    }
    indicator.classList.add("is-visible");
  }

  function hidePrerollIndicator() {
    var indicator = document.getElementById("lrcinject-preroll");
    if (!indicator) return;
    indicator.classList.remove("is-visible");
    if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
  }

  function setPrerollClasses(enable) {
    var lineEls = document.querySelectorAll("#lrcinject-overlay .lrcinject-line");
    var binding = overlayState.binding;
    var parsedLines = binding ? (binding.parsedLines || binding.lines || []) : [];

    if (!enable) {
      for (var i = 0; i < lineEls.length; i++) {
        lineEls[i].classList.remove("is-preroll-upcoming", "is-preroll-first", "is-preroll-second");
      }
      return;
    }

    var firstTimedIndex = -1;
    for (var j = 0; j < parsedLines.length; j++) {
      if (Number.isFinite(Number(parsedLines[j].start))) {
        firstTimedIndex = j;
        break;
      }
    }

    for (var k = 0; k < lineEls.length; k++) {
      var idx = Number(lineEls[k].getAttribute("data-index"));
      lineEls[k].classList.remove("is-preroll-first", "is-preroll-second", "is-preroll-upcoming");

      if (firstTimedIndex >= 0 && idx === firstTimedIndex) {
        lineEls[k].classList.add("is-preroll-first");
      } else if (firstTimedIndex >= 0 && idx === firstTimedIndex + 1) {
        lineEls[k].classList.add("is-preroll-second");
      } else if (firstTimedIndex >= 0 && idx > firstTimedIndex + 1) {
        lineEls[k].classList.add("is-preroll-upcoming");
      }
    }
  }

  function scrollToWaitingStart() {
    var linesContainer = document.getElementById("lrcinject-lines");
    if (!linesContainer) return;
    linesContainer.style.transform = "translate3d(0, 0px, 0)";
  }

  function scrollToWaitingEnd() {
    var panel = document.querySelector("#lrcinject-overlay .lrcinject-lyrics-panel");
    var linesContainer = document.getElementById("lrcinject-lines");
    var lastLine = document.querySelector("#lrcinject-overlay .lrcinject-line:last-child");

    if (!panel || !linesContainer || !lastLine) return;

    var panelTarget = panel.clientHeight * 0.34;
    var lineTop = lastLine.offsetTop;
    var translateY = Math.round(panelTarget - lineTop);

    linesContainer.style.transform = "translate3d(0, " + translateY + "px, 0)";
  }

  function setTimelineStateDebug(state, currentTime) {
    if (state === _lastTimelineState) return;
    _lastTimelineState = state;
    console.log("[LRCInject] timeline state", state, "time", currentTime);
  }

  function renderLyricsLines(lines) {
    var container = document.getElementById("lrcinject-lines");
    if (!container) {
      debug("ERROR: lyrics container missing, calling ensureOverlay first");
      ensureOverlay();
      container = document.getElementById("lrcinject-lines");
    }
    if (!container) {
      debug("ERROR: still cannot find lyrics container");
      return;
    }

    var renderItems = buildRenderItems(lines);
    overlayState.renderItems = renderItems;
    overlayState.activeRenderIndex = -1;

    debug("rendering", lines.length, "lyric lines,", renderItems.length, "render items into DOM");

    container.textContent = "";

    var padTop = document.createElement("div");
    padTop.className = "lrcinject-spacer";
    container.appendChild(padTop);

    for (var i = 0; i < renderItems.length; i++) {
      var item = renderItems[i];

      if (item.type === "gap-indicator") {
        var gapLine = document.createElement("div");
        gapLine.className = "lrcinject-gap-line";
        gapLine.setAttribute("data-render-index", String(i));
        gapLine.setAttribute("data-gap-after-line-index", String(item.afterLineIndex));
        var gapLineInner = document.createElement("div");
        gapLineInner.className = "lrcinject-gap-line-inner";
        var gapInner = createGapIndicatorEl();
        gapLineInner.appendChild(gapInner);
        gapLine.appendChild(gapLineInner);
        container.appendChild(gapLine);
        continue;
      }

      var line = item.line;
      var lineIdx = item.lineIndex;
      var el = document.createElement("div");
      el.className = "lrcinject-line";
      el.setAttribute("data-index", String(lineIdx));
      el.setAttribute("data-render-index", String(i));
      el.setAttribute("data-start", String(line.start));
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");

      var base = document.createElement("span");
      base.className = "lrcinject-line-base";

      var lineText = stripEnhancedLrcTags(line.text || "\u266a");
      var words = line.words;

      if (words && words.length > 0) {
        el.classList.add("lrcinject-line--worded");
        for (var w = 0; w < words.length; w++) {
          var word = document.createElement("span");
          word.className = "lrcinject-word";
          word.textContent = stripEnhancedLrcTags(words[w].text);
          word.setAttribute("data-word-index", String(w));
          base.appendChild(word);
          if (w < words.length - 1) {
            base.appendChild(document.createTextNode(" "));
          }
        }
      } else {
        var tokens = lineText.split(/(\s+)/);
        var wordIdx = 0;
        for (var ti = 0; ti < tokens.length; ti++) {
          if (/^\s+$/.test(tokens[ti])) {
            base.appendChild(document.createTextNode(tokens[ti]));
          } else if (tokens[ti]) {
            var word = document.createElement("span");
            word.className = "lrcinject-word";
            word.textContent = tokens[ti];
            word.setAttribute("data-word-index", String(wordIdx));
            base.appendChild(word);
            wordIdx++;
          }
        }
      }

      el.appendChild(base);

      var highlight = document.createElement("span");
      highlight.className = "lrcinject-line-highlight";
      highlight.setAttribute("aria-hidden", "true");
      el.appendChild(highlight);

      container.appendChild(el);
    }

    var padBot = document.createElement("div");
    padBot.className = "lrcinject-spacer";
    container.appendChild(padBot);

    var renderedLyrics = container.querySelectorAll(".lrcinject-line").length;
    var renderedGaps = container.querySelectorAll(".lrcinject-gap-indicator").length;
    debug("DOM render complete,", renderedLyrics, "lyric lines,", renderedGaps, "gap indicators");
  }

  function getActiveLineIndex(lines, currentTime, offset) {
    if (!Array.isArray(lines) || lines.length === 0) return -1;

    var t = currentTime + (offset || 0);

    if (t < lines[0].start) {
      return 0;
    }

    for (var i = 0; i < lines.length; i++) {
      var start = lines[i].start;
      var end = lines[i].end != null ? lines[i].end : (lines[i + 1] ? lines[i + 1].start : Infinity);

      if (t >= start && t < end) {
        return i;
      }
    }

    return lines.length - 1;
  }

  function scrollToActiveRenderItem(activeRenderIdx) {
    if (activeRenderIdx < 0) return;

    var panel = document.querySelector("#lrcinject-overlay .lrcinject-lyrics-panel");
    var linesContainer = document.getElementById("lrcinject-lines");
    if (!panel || !linesContainer) return;

    var activeEl = linesContainer.querySelector(
      '[data-render-index="' + activeRenderIdx + '"]'
    );

    if (!activeEl || activeEl.offsetHeight === 0) return;

    var panelH = panel.clientHeight;
    var panelTarget = panelH * 0.40;
    var elTop = activeEl.offsetTop;
    var translateY = Math.round(panelTarget - elTop);

    var containerH = linesContainer.scrollHeight;
    var minTranslate = Math.round(panelH - containerH + panelH * 0.12);
    var maxTranslate = Math.round(panelH * 0.88);
    translateY = Math.max(minTranslate, Math.min(maxTranslate, translateY));

    linesContainer.style.transform = "translate3d(0, " + translateY + "px, 0)";
  }

  function updateActiveClasses(activeRenderIdx, currentTime, offset) {
    var renderItems = overlayState.renderItems || [];
    var activeItem = renderItems[activeRenderIdx];
    var binding = overlayState.binding;
    var parsedLines = binding ? (binding.parsedLines || binding.lines || []) : [];
    var t = (currentTime || 0) + (offset || 0);

    var activeLineIdx = (activeItem && activeItem.type === "lyric") ? activeItem.lineIndex : -1;
    var gapActive = !!(activeItem && activeItem.type === "gap-indicator");
    var gapAfterIdx = gapActive ? activeItem.afterLineIndex : -1;

    var lineEls = document.querySelectorAll("#lrcinject-overlay .lrcinject-line");
    for (var i = 0; i < lineEls.length; i++) {
      var el = lineEls[i];
      var idx = Number(el.getAttribute("data-index"));
      var renderIdx = Number(el.getAttribute("data-render-index"));
      var lineData = parsedLines[idx];
      var nextLine = parsedLines[idx + 1];
      var nextStart = nextLine
        ? nextLine.start
        : (lineData && Number.isFinite(lineData.end) ? lineData.end : Infinity);

      var isActive, isCompleted, isUpcoming;

      if (gapActive) {
        isActive = false;
        isCompleted = idx <= gapAfterIdx;
        isUpcoming = idx > gapAfterIdx;
      } else {
        isActive = idx === activeLineIdx;
        isCompleted = !isActive && t >= nextStart;
        isUpcoming = !isActive && !isCompleted;
      }

      el.classList.toggle("is-active", isActive);
      el.classList.toggle("is-completed", isCompleted);
      el.classList.toggle("is-upcoming", isUpcoming);
      el.classList.remove("is-near", "is-far");

      if (activeRenderIdx >= 0 && Number.isFinite(renderIdx)) {
        var distance = Math.abs(renderIdx - activeRenderIdx);
        if (distance === 1) {
          el.classList.add("is-near");
        } else if (distance >= 2) {
          el.classList.add("is-far");
        }
      }
    }

    var gapLineEls = document.querySelectorAll("#lrcinject-overlay .lrcinject-gap-line");
    for (var j = 0; j < gapLineEls.length; j++) {
      var gapLineEl = gapLineEls[j];
      var gRenderIdx = Number(gapLineEl.getAttribute("data-render-index"));
      gapLineEl.classList.toggle("is-active", gRenderIdx === activeRenderIdx);
    }
  }

  function easeInOutSoft(t) {
    var x = clamp01(t);
    return x * x * (3 - 2 * x);
  }

  var WORD_END_GAP = 0.12;

  function getWordTimings(line, wordEls, lineEnd) {
    var words = line.words;
    var hasTimings = Array.isArray(words) && words.length >= 2 &&
      words.some(function (w) { return Number.isFinite(w.start); });

    var timings = [];
    if (hasTimings) {
      for (var i = 0; i < words.length; i++) {
        var ws = Number(words[i].start);
        var we;
        if (i + 1 < words.length) {
          we = Number(words[i + 1].start);
        } else {
          we = Math.max(ws + 0.08, lineEnd - WORD_END_GAP);
        }
        timings.push({ start: ws, end: we });
      }
    } else {
      var count = wordEls.length;
      if (count > 0) {
        var span = (lineEnd - line.start) / count;
        for (var j = 0; j < count; j++) {
          var s = line.start + j * span;
          var e;
          if (j + 1 < count) {
            e = line.start + (j + 1) * span;
          } else {
            e = Math.max(s + 0.08, lineEnd - WORD_END_GAP);
          }
          timings.push({ start: s, end: e });
        }
      }
    }
    return timings;
  }

  function findActiveWordInfo(timings, t) {
    for (var i = 0; i < timings.length; i++) {
      if (t >= timings[i].start && t < timings[i].end) {
        var local = clamp01((t - timings[i].start) / Math.max(0.001, timings[i].end - timings[i].start));
        return { index: i, progress: easeInOutSoft(local) };
      }
    }
    if (timings.length > 0 && t >= timings[timings.length - 1].start) {
      return { index: timings.length - 1, progress: 1 };
    }
    if (timings.length > 0 && t < timings[0].start) {
      return { index: 0, progress: 0 };
    }
    return null;
  }

  function groupWordsIntoRows(wordEls, lineRect) {
    var rows = [];
    for (var i = 0; i < wordEls.length; i++) {
      var rect = wordEls[i].getBoundingClientRect();
      if (!rect.width || !rect.height) continue;

      var found = false;
      for (var r = 0; r < rows.length; r++) {
        if (Math.abs(rows[r].top - rect.top) <= 6) {
          rows[r].elements.push(wordEls[i]);
          rows[r].left = Math.min(rows[r].left, rect.left);
          rows[r].right = Math.max(rows[r].right, rect.right);
          rows[r].height = Math.max(rows[r].height, rect.height);
          found = true;
          break;
        }
      }
      if (!found) {
        rows.push({
          top: rect.top,
          left: rect.left,
          right: rect.right,
          height: rect.height,
          elements: [wordEls[i]]
        });
      }
    }

    rows.sort(function (a, b) { return a.top - b.top; });

    return rows.map(function (row) {
      return {
        left: row.left - lineRect.left,
        top: row.top - lineRect.top,
        width: row.right - row.left,
        height: row.height,
        elements: row.elements
      };
    });
  }

  function buildHighlightRowHTML(row) {
    var parts = [];
    for (var i = 0; i < row.elements.length; i++) {
      parts.push(stripEnhancedLrcTags(row.elements[i].textContent));
      if (i < row.elements.length - 1) {
        // Preserve whitespace between words
        var next = row.elements[i + 1];
        if (next && next.previousSibling && next.previousSibling.nodeType === 3) {
          parts.push(next.previousSibling.textContent);
        } else {
          parts.push(" ");
        }
      }
    }
    return parts.join("");
  }

  var REVEAL_FINISH_LEAD = 0.42;

  function updateHighlightSweep(activeRenderIdx, currentTime, offset) {
    var renderItems = overlayState.renderItems || [];
    var activeItem = renderItems[activeRenderIdx];
    var activeLineIdx = (activeItem && activeItem.type === "lyric") ? activeItem.lineIndex : -1;

    var lineEls = document.querySelectorAll("#lrcinject-overlay .lrcinject-line");
    var binding = overlayState.binding;
    var parsedLines = binding ? (binding.parsedLines || binding.lines || []) : [];
    var t = (currentTime || 0) + (offset || 0);

    for (var li = 0; li < lineEls.length; li++) {
      var el = lineEls[li];
      var idx = Number(el.getAttribute("data-index"));
      var highlightEl = el.querySelector(".lrcinject-line-highlight");
      if (!highlightEl) continue;

      if (idx !== activeLineIdx || !parsedLines[idx]) {
        highlightEl.textContent = "";
        el.classList.remove("is-visual-complete");
        continue;
      }

      var line = parsedLines[idx];
      var nextLine = parsedLines[idx + 1];
      var rawLineEnd = Number.isFinite(line.end)
        ? line.end
        : (Number.isFinite(nextLine && nextLine.start) ? nextLine.start : line.start + 3);

      var nextLineStart = Number.isFinite(nextLine && nextLine.start) ? nextLine.start : null;
      var visualLineEnd = Number.isFinite(nextLineStart)
        ? Math.max(line.start, nextLineStart - REVEAL_FINISH_LEAD)
        : rawLineEnd;

      var forceComplete = Number.isFinite(visualLineEnd) && t >= visualLineEnd;

      var wordEls = el.querySelectorAll(".lrcinject-line-base .lrcinject-word");
      if (wordEls.length === 0) {
        highlightEl.textContent = "";
        el.classList.remove("is-visual-complete");
        continue;
      }

      var timings = getWordTimings(line, wordEls, visualLineEnd);
      var activeInfo = findActiveWordInfo(timings, t);

      var lastWordDone = !!(activeInfo &&
        timings.length > 0 &&
        activeInfo.index === timings.length - 1 &&
        activeInfo.progress >= 0.99);

      var lineRevealed = forceComplete || lastWordDone;

      if (!activeInfo && !lineRevealed) {
        highlightEl.textContent = "";
        el.classList.remove("is-visual-complete");
        continue;
      }

      var lineRect = el.getBoundingClientRect();
      var rows = groupWordsIntoRows(wordEls, lineRect);

      var activeRowIdx = -1;
      var activeWordEl = null;
      var activeWordRect = null;
      if (activeInfo) {
        activeWordEl = wordEls[activeInfo.index];
        activeWordRect = activeWordEl.getBoundingClientRect();
        for (var ri = 0; ri < rows.length; ri++) {
          for (var ei = 0; ei < rows[ri].elements.length; ei++) {
            if (rows[ri].elements[ei] === activeWordEl) {
              activeRowIdx = ri;
              break;
            }
          }
          if (activeRowIdx >= 0) break;
        }
      }

      var existingRows = highlightEl.querySelectorAll(".lrcinject-highlight-row");

      if (existingRows.length !== rows.length) {
        highlightEl.textContent = "";
        for (var rj = 0; rj < rows.length; rj++) {
          var rowEl = document.createElement("span");
          rowEl.className = "lrcinject-highlight-row";
          rowEl.style.setProperty("--row-left", rows[rj].left.toFixed(1) + "px");
          rowEl.style.setProperty("--row-top", rows[rj].top.toFixed(1) + "px");
          rowEl.textContent = buildHighlightRowHTML(rows[rj]);
          highlightEl.appendChild(rowEl);
        }
        existingRows = highlightEl.querySelectorAll(".lrcinject-highlight-row");
      } else {
        for (var rk = 0; rk < rows.length; rk++) {
          existingRows[rk].style.setProperty("--row-left", rows[rk].left.toFixed(1) + "px");
          existingRows[rk].style.setProperty("--row-top", rows[rk].top.toFixed(1) + "px");
        }
      }

      if (lineRevealed) {
        for (var fc = 0; fc < existingRows.length; fc++) {
          existingRows[fc].classList.remove("is-row-pending", "is-row-active");
          existingRows[fc].classList.add("is-row-completed");
          existingRows[fc].style.setProperty("--row-progress", "100%");
        }
        el.classList.add("is-visual-complete");
      } else {
        el.classList.remove("is-visual-complete");

        for (var rp = 0; rp < rows.length; rp++) {
          var rowEl = existingRows[rp];
          var rowProgress;
          if (rp < activeRowIdx) {
            rowProgress = 100;
          } else if (rp === activeRowIdx && activeWordRect) {
            var wordStartX = activeWordRect.left - lineRect.left - rows[rp].left;
            var wordWidth = activeWordRect.width;
            var sweepX = wordStartX + wordWidth * activeInfo.progress;
            rowProgress = clamp01(sweepX / Math.max(1, rows[rp].width)) * 100;
          } else {
            rowProgress = 0;
          }

          var safeProgress = clamp01(rowProgress / 100);
          var isPending = rp > activeRowIdx || (rp === activeRowIdx && safeProgress <= 0.005);
          var isRowActive = rp === activeRowIdx && !isPending;
          var isRowCompleted = rp < activeRowIdx || safeProgress >= 0.995;

          rowEl.classList.toggle("is-row-pending", isPending);
          rowEl.classList.toggle("is-row-active", isRowActive);
          rowEl.classList.toggle("is-row-completed", isRowCompleted);
          rowEl.style.setProperty("--row-progress", (safeProgress * 100).toFixed(2) + "%");
        }
      }
    }
  }

  var GAP_DOT_THRESHOLD = 5;

  function getEffectiveLineEnd(line, nextLineStart) {
    var lineStart = Number(line.start);
    if (!Number.isFinite(lineStart)) return null;

    var words = Array.isArray(line.words)
      ? line.words.filter(function (w) { return Number.isFinite(Number(w.start)); })
      : [];

    var estimatedEnd;

    if (words.length > 0) {
      var lastWordStart = Number(words[words.length - 1].start);
      estimatedEnd = lastWordStart + 0.75;
    } else {
      var textLength = String(line.text || "").trim().length;
      var estimatedDuration = Math.min(3.0, Math.max(1.2, textLength * 0.045));
      estimatedEnd = lineStart + estimatedDuration;
    }

    if (Number.isFinite(nextLineStart)) {
      return Math.min(estimatedEnd, nextLineStart - 0.1);
    }

    return estimatedEnd;
  }

  function buildRenderItems(lines) {
    var items = [];

    for (var i = 0; i < lines.length; i++) {
      items.push({ type: "lyric", lineIndex: i, line: lines[i] });

      if (i < lines.length - 1) {
        var currentLineEnd = getEffectiveLineEnd(lines[i], lines[i + 1].start);
        var nextLineStart = lines[i + 1].start;

        if (Number.isFinite(currentLineEnd) && Number.isFinite(nextLineStart)) {
          var gapDuration = nextLineStart - currentLineEnd;
          if (gapDuration > GAP_DOT_THRESHOLD) {
            var dotStart = currentLineEnd + GAP_DOT_THRESHOLD;
            var dotEnd = nextLineStart;
            items.push({ type: "gap-indicator", start: dotStart, end: dotEnd, afterLineIndex: i });
          }
        }
      }
    }

    return items;
  }

  function getRenderItemStart(item) {
    if (item.type === "lyric") return Number(item.line.start);
    if (item.type === "gap-indicator") return Number(item.start);
    return NaN;
  }

  function getRenderItemEnd(renderItems, index) {
    var item = renderItems[index];
    if (item.type === "gap-indicator") return Number(item.end);
    var next = renderItems[index + 1];
    if (!next) return Infinity;
    return getRenderItemStart(next);
  }

  function getActiveRenderIndex(renderItems, currentTime, offset) {
    if (!renderItems || renderItems.length === 0) return -1;
    var t = currentTime + (offset || 0);

    for (var i = 0; i < renderItems.length; i++) {
      var start = getRenderItemStart(renderItems[i]);
      var end = getRenderItemEnd(renderItems, i);
      if (Number.isFinite(start) && t >= start && t < end) {
        return i;
      }
    }

    return -1;
  }

  function createGapIndicatorEl() {
    var el = document.createElement("div");
    el.className = "lrcinject-gap-indicator";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = "<span></span><span></span><span></span>";
    return el;
  }

  function startSyncLoop() {
    stopSyncLoop();

    debug("sync loop started");

    var tick = function () {
      if (!overlayState.visible || !overlayState.binding) return;

      var currentAudio = getActiveAudio();
      if (!currentAudio) {
        overlayState.raf = requestAnimationFrame(tick);
        return;
      }

      var lines = overlayState.binding.parsedLines || overlayState.binding.lines || [];
      var offset = overlayState.binding.userOffset || 0;
      var playbackState = getLyricsPlaybackState(lines, currentAudio.currentTime, offset, currentAudio.duration);
      setTimelineStateDebug(playbackState, currentAudio.currentTime);

      if (playbackState === "before-start") {
        showPrerollIndicator();
        if (overlayState.activeRenderIndex !== -1) {
          overlayState.activeRenderIndex = -1;
          scrollToWaitingStart();
        }
        updateActiveClasses(-1, currentAudio.currentTime, offset);
        updateHighlightSweep(-1, currentAudio.currentTime, offset);
        setPrerollClasses(true);
      } else if (playbackState === "after-end") {
        hidePrerollIndicator();
        setPrerollClasses(false);
        if (overlayState.activeRenderIndex !== -2) {
          overlayState.activeRenderIndex = -2;
          updateActiveClasses(-1, currentAudio.currentTime, offset);
          updateHighlightSweep(-1, currentAudio.currentTime, offset);
          scrollToWaitingEnd();
        }
      } else {
        hidePrerollIndicator();
        setPrerollClasses(false);
        var renderItems = overlayState.renderItems || [];
        var renderIdx = getActiveRenderIndex(renderItems, currentAudio.currentTime, offset);

        var renderChanged = renderIdx !== overlayState.activeRenderIndex;
        if (renderChanged) {
          overlayState.activeRenderIndex = renderIdx;
        }

        updateActiveClasses(renderIdx, currentAudio.currentTime, offset);
        updateHighlightSweep(renderIdx, currentAudio.currentTime, offset);

        if (renderChanged) {
          scrollToActiveRenderItem(renderIdx);
        }
      }

      overlayState.raf = requestAnimationFrame(tick);
    };

    overlayState.raf = requestAnimationFrame(tick);
  }

  function stopSyncLoop() {
    if (overlayState.raf) {
      cancelAnimationFrame(overlayState.raf);
      overlayState.raf = null;
    }
  }

  function setOverlayVisible(visible) {
    var overlay = ensureOverlay();

    overlayState.visible = visible;
    if (visible) {
      overlay.classList.add("is-visible");
      applyInheritedTypography();
      applyLayoutMode();
    } else {
      overlay.classList.remove("is-visible");
      hidePrerollIndicator();
      setPrerollClasses(false);
      _lastTimelineState = null;
      removeLayoutMode();
    }

    debug("overlay visible:", visible);

    if (visible) {
      startSyncLoop();
    } else {
      stopSyncLoop();
    }
  }

  async function toggleOverlay() {
    if (!AMX.isExtensionContextValid()) {
      debug("context invalid, cannot toggle");
      return { visible: false, reason: "context_invalid" };
    }

    var playerState = getPlayerState();
    debug("toggle: player state -", playerState.title || "(no title)", playerState.paused ? "paused" : "playing");

    var trackKey = makeTrackKeyFromState(playerState);
    debug("toggle: track key -", trackKey);

    var binding = null;

    try {
      binding = await AMX.Storage.getBinding(trackKey);
    } catch (error) {
      debug("toggle: failed to get binding", error);
    }

    if (!binding) {
      debug("toggle: no binding for", trackKey);
      showToast("No lyrics imported for this track.");
      return { visible: false, reason: "missing_binding", trackKey: trackKey };
    }

    var parsedLines = binding.parsedLines || [];
    debug("toggle: binding found -", binding.title, "/", binding.artist, "- lines:", parsedLines.length);

    if (!parsedLines.length) {
      debug("toggle: binding has no parsed lines");
      showToast("Lyrics file has no parsed timed lines.");
      return { visible: false, reason: "empty_lines" };
    }

    ensureOverlay();

    if (overlayState.renderedTrackKey !== trackKey) {
      debug("toggle: rendering", parsedLines.length, "lines for new track");
      renderLyricsLines(parsedLines);
      overlayState.renderedTrackKey = trackKey;
      overlayState.binding = binding;
      overlayState.activeRenderIndex = -1;

      var playbackState = getLyricsPlaybackState(parsedLines, playerState.currentTime, binding.userOffset || 0, playerState.duration);
      setTimelineStateDebug(playbackState, playerState.currentTime);

      if (playbackState === "before-start") {
        overlayState.activeRenderIndex = -1;
        updateActiveClasses(-1, playerState.currentTime, binding.userOffset || 0);
        updateHighlightSweep(-1, playerState.currentTime, binding.userOffset || 0);
        showPrerollIndicator();
        setPrerollClasses(true);
        scrollToWaitingStart();
      } else if (playbackState === "after-end") {
        overlayState.activeRenderIndex = -2;
        updateActiveClasses(-1, playerState.currentTime, binding.userOffset || 0);
        updateHighlightSweep(-1, playerState.currentTime, binding.userOffset || 0);
        hidePrerollIndicator();
        setPrerollClasses(false);
        scrollToWaitingEnd();
      } else {
        hidePrerollIndicator();
        setPrerollClasses(false);
        var renderItems = overlayState.renderItems || [];
        var initialRenderIdx = getActiveRenderIndex(renderItems, playerState.currentTime, binding.userOffset || 0);
        overlayState.activeRenderIndex = initialRenderIdx;
        updateActiveClasses(initialRenderIdx, playerState.currentTime, binding.userOffset || 0);
        updateHighlightSweep(initialRenderIdx, playerState.currentTime, binding.userOffset || 0);
        if (initialRenderIdx >= 0) {
          scrollToActiveRenderItem(initialRenderIdx);
        }
      }
    } else {
      debug("toggle: same track, skipping re-render");
    }

    setOverlayVisible(!overlayState.visible);

    return {
      visible: overlayState.visible,
      trackKey: trackKey,
      lineCount: parsedLines.length,
    };
  }

  function setupMessageHandler() {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || !message.type) return false;
      debug("message received:", message.type);

      if (message.type === "AMX_PING") {
        sendResponse({
          ok: true,
          source: "content-script",
          url: location.href,
          hasAudio: !!getActiveAudio(),
          audioCount: document.querySelectorAll("audio").length,
        });
        return true;
      }

      if (message.type === "AMX_GET_PLAYER_STATE") {
        var state = _cachedState || getPlayerState();
        debug("returning player state:", state.title || "(no title)", state.paused ? "paused" : "playing");
        sendResponse({ ok: true, state: state });
        return true;
      }

      if (message.type === "AMX_GET_LYRICS_STATE") {
        var track = null;
        try { track = AMX.TrackDetector.getCurrentTrack(); } catch (e) {}
        sendResponse({
          ok: true,
          track: track,
          hasBinding: !!_currentBinding,
          binding: _currentBinding,
          settings: _settings,
        });
        return true;
      }

      if (message.type === "AMX_IMPORT_LYRICS") {
        handleImport(message.content, message.sourceType, message.filename)
          .then(function (result) { sendResponse(result); });
        return true;
      }

      if (message.type === "AMX_REMOVE_LYRICS") {
        handleRemove().then(function (result) { sendResponse(result); });
        return true;
      }

      if (message.type === "AMX_SET_OFFSET") {
        handleSetOffset(message.offset).then(function (result) { sendResponse(result); });
        return true;
      }

      if (message.type === "AMX_TOGGLE_OVERLAY" || message.type === "LRCINJECT_TOGGLE_OVERLAY") {
        toggleOverlay()
          .then(function (result) { sendResponse({ ok: true, result: result }); })
          .catch(function (error) {
            console.error("[LRCInject] toggle failed:", error);
            sendResponse({ ok: false, error: String((error && error.message) || error) });
          });
        return true;
      }

      if (message.type === "AMX_SET_USE_CUSTOM") {
        _settings = _settings || {};
        _settings.useCustomOverNative = message.value;
        try { AMX.Storage.saveSettings(_settings); } catch (e) {
          debug("failed to save settings:", e);
        }
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === "AMX_DEBUG_TOGGLE") {
        AMX.DEBUG = !AMX.DEBUG;
        sendResponse({ ok: true, debug: AMX.DEBUG });
        return true;
      }

      return false;
    });
  }

  function handleImport(content, sourceType, filename) {
    return new Promise(function (resolve) {
      debug("import start:", filename, "type:", sourceType, "raw length:", content.length);

      var lines;
      if (sourceType === "lrc") {
        lines = AMX.LrcParser.parse(content);
      } else if (sourceType === "srt") {
        lines = AMX.SrtParser.parse(content);
      } else if (sourceType === "json") {
        lines = AMX.JsonParser.parse(content);
      } else {
        resolve({ ok: false, error: "Unknown file type" });
        return;
      }

      debug("parsed", lines ? lines.length : 0, "timed lines from", filename);
      if (lines && lines.length > 0) {
        debug("first line:", lines[0].start.toFixed(2), "-", lines[0].text.substring(0, 50));
        debug("last line:", lines[lines.length - 1].start.toFixed(2), "-", lines[lines.length - 1].text.substring(0, 50));
      }

      if (!lines || lines.length === 0) {
        resolve({ ok: false, error: "No timed lyrics found in file" });
        return;
      }

      var state = _cachedState || getPlayerState();
      var trackKey = makeTrackKeyFromState(state);

      if (!trackKey) {
        resolve({ ok: false, error: "Cannot detect current track. Play a song first." });
        return;
      }

      var binding = AMX.Storage.createBinding(
        trackKey,
        state.title || "Unknown",
        state.artist || "Unknown",
        state.duration,
        filename,
        sourceType,
        content,
        lines
      );

      debug("saving binding for key:", trackKey);

      AMX.Storage.saveBinding(trackKey, binding)
        .then(function () {
          _currentBinding = binding;
          _currentTrackKey = trackKey;

          debug("binding saved:", lines.length, "lines for", state.title);

          resolve({
            ok: true,
            success: true,
            lineCount: lines.length,
            title: state.title,
            artist: state.artist,
            trackKey: trackKey,
          });
        })
        .catch(function (err) {
          debug("failed to save binding:", err);
          resolve({ ok: false, error: "Failed to save lyrics: " + String(err) });
        });
    });
  }

  function handleRemove() {
    return new Promise(function (resolve) {
      if (!_currentTrackKey) {
        resolve({ ok: false, error: "No track detected" });
        return;
      }

      AMX.Storage.removeBinding(_currentTrackKey)
        .then(function () {
          _currentBinding = null;
          overlayState.binding = null;
          overlayState.renderedTrackKey = null;
          overlayState.activeRenderIndex = -1;
          overlayState.renderItems = null;
          setOverlayVisible(false);
          var overlay = document.getElementById("lrcinject-overlay");
          if (overlay) overlay.remove();
          debug("binding removed for:", _currentTrackKey);
          resolve({ ok: true });
        })
        .catch(function (err) {
          debug("failed to remove binding:", err);
          resolve({ ok: false, error: String(err) });
        });
    });
  }

  function handleSetOffset(offset) {
    return new Promise(function (resolve) {
      if (!_currentBinding) {
        resolve({ ok: false, error: "No binding" });
        return;
      }
      _currentBinding.userOffset = offset;
      _currentBinding.updatedAt = Date.now();
      try { AMX.Storage.saveBinding(_currentTrackKey, _currentBinding); } catch (e) {
        debug("failed to save offset:", e);
      }
      debug("offset set to:", offset);
      resolve({ ok: true });
    });
  }

  function onPlayerStateUpdate(state) {
    if (_stopped) return;
    if (!AMX.isExtensionContextValid()) {
      cleanup();
      return;
    }

    try {
      AMX.TrackDetector.checkForChange(state);
    } catch (error) {
      debug("onPlayerStateUpdate failed:", error);
    }
  }

  function onTrackChange(track, prevKey) {
    if (_stopped) return;
    _currentTrackKey = track.key;
    debug("track changed:", track.title, "-", track.artist, "key:", track.key);

    overlayState.binding = null;
    overlayState.renderedTrackKey = null;
    overlayState.activeRenderIndex = -1;
    overlayState.renderItems = null;

    AMX.Storage.getBinding(track.key)
      .then(function (binding) {
        _currentBinding = binding;
        if (binding) {
          debug("found binding for track:", binding.title);
        } else {
          debug("no lyrics binding for this track");
        }
      })
      .catch(function (error) {
        debug("failed to load binding:", error);
        _currentBinding = null;
      });
  }

  function startObserving() {
    if (_observer) _observer.disconnect();

    _observer = new MutationObserver(
      AMX.debounce(function () {
        if (_stopped) return;
        if (!AMX.isExtensionContextValid()) {
          cleanup();
          return;
        }
        var state = getPlayerState();
        if (state.title || state.artist) {
          try { AMX.TrackDetector.checkForChange(state); } catch (e) {}
        }
      }, 800)
    );

    _observer.observe(document.body, { childList: true, subtree: true });
    debug("MutationObserver initialized");
  }

  function setupRouteChangeDetection() {
    if (_routeChangeHandlerInstalled) return;
    _routeChangeHandlerInstalled = true;

    var origPush = history.pushState;
    history.pushState = function () {
      origPush.apply(this, arguments);
      window.dispatchEvent(new Event("amx-route-change"));
    };

    var origReplace = history.replaceState;
    history.replaceState = function () {
      origReplace.apply(this, arguments);
      window.dispatchEvent(new Event("amx-route-change"));
    };

    window.addEventListener("popstate", function () {
      window.dispatchEvent(new Event("amx-route-change"));
    });

    window.addEventListener(
      "amx-route-change",
      AMX.debounce(function () {
        if (_stopped) return;
        debug("route change detected:", location.href);
        _initialized = false;
        AMX.TrackDetector.reset();
        removeLayoutMode();
        setOverlayVisible(false);
        overlayState.binding = null;
        overlayState.renderedTrackKey = null;
        overlayState.activeRenderIndex = -1;
        overlayState.renderItems = null;
        _currentTrackKey = null;
        _currentBinding = null;
        _playerRoot = null;
        init();
      }, 600)
    );

    debug("route change detection installed");
  }

  function init() {
    if (_initialized) return;
    _initialized = true;

    debug("initializing (URL:", location.href, ")");

    AMX.MediaBridge.init();

    AMX.Storage.getSettings()
      .then(function (s) { _settings = s; })
      .catch(function (e) { debug("failed to load settings:", e); });

    AMX.MediaBridge.onStateUpdate(onPlayerStateUpdate);
    AMX.TrackDetector.onTrackChange(onTrackChange);

    startObserving();

    AMX.MediaBridge.requestState();

    setTimeout(function () {
      if (_stopped) return;
      var state = getPlayerState();
      if (state.title || state.artist || state.hasAudio) {
        AMX.TrackDetector.checkForChange(state);
      }
    }, 1000);

    debug("initialization complete");
  }

  setupMessageHandler();
  debug("message handler registered");

  _heartbeatInterval = setInterval(updateHeartbeat, 500);
  debug("heartbeat started");

  setupRouteChangeDetection();

  init();

  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);
})();
