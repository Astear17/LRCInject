var AMX = window.AMX || {};
window.AMX = AMX;

AMX.Renderer = {
  _root: null,
  _linesContainer: null,
  _linesEls: [],
  _activeIndex: -1,
  _visible: false,
  _toggleBtn: null,

  createOverlay: function () {
    if (AMX.Renderer._root) return AMX.Renderer._root;

    var root = document.createElement("div");
    root.id = "lrcinject-overlay";
    root.className = "lrcinject-overlay";

    var panel = document.createElement("div");
    panel.className = "lrcinject-panel";

    var closeBtn = document.createElement("button");
    closeBtn.className = "lrcinject-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", function () {
      AMX.Renderer.hide();
    });

    var linesWrap = document.createElement("div");
    linesWrap.className = "lrcinject-lines";

    panel.appendChild(closeBtn);
    panel.appendChild(linesWrap);
    root.appendChild(panel);
    document.body.appendChild(root);

    AMX.Renderer._root = root;
    AMX.Renderer._linesContainer = linesWrap;

    AMX.log("Overlay created");
    return root;
  },

  destroyOverlay: function () {
    if (AMX.Renderer._root) {
      AMX.Renderer._root.remove();
      AMX.Renderer._root = null;
      AMX.Renderer._linesContainer = null;
      AMX.Renderer._linesEls = [];
      AMX.Renderer._activeIndex = -1;
      AMX.Renderer._visible = false;
    }
  },

  injectToggleButton: function () {
    if (AMX.Renderer._toggleBtn) return;

    var btn = document.createElement("button");
    btn.id = "lrcinject-toggle-btn";
    btn.className = "lrcinject-toggle-btn";
    btn.title = "LRCInject Lyrics";
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
      '<span>Lyrics</span>';

    btn.addEventListener("click", function () {
      if (AMX.Renderer.isVisible()) {
        AMX.Renderer.hide();
      } else {
        AMX.Renderer.show();
      }
    });

    var tryInsert = function () {
      var playerArea =
        document.querySelector('[data-testid="player-controls"]') ||
        document.querySelector('[class*="playback-controls"]') ||
        document.querySelector('[class*="player-controls"]') ||
        document.querySelector("amp-chrome-player");

      if (playerArea) {
        playerArea.appendChild(btn);
        AMX.log("Toggle button injected into player area");
        return true;
      }

      var bottomBar = document.querySelector('[class*="chrome-player"]');
      if (bottomBar) {
        bottomBar.appendChild(btn);
        AMX.log("Toggle button injected into chrome-player");
        return true;
      }

      return false;
    };

    if (!tryInsert()) {
      document.body.appendChild(btn);
      AMX.log("Toggle button appended to body (player area not found)");
    }

    AMX.Renderer._toggleBtn = btn;
  },

  removeToggleButton: function () {
    if (AMX.Renderer._toggleBtn) {
      AMX.Renderer._toggleBtn.remove();
      AMX.Renderer._toggleBtn = null;
    }
  },

  renderLines: function (lines) {
    if (!AMX.Renderer._linesContainer) AMX.Renderer.createOverlay();
    var container = AMX.Renderer._linesContainer;
    container.innerHTML = "";
    AMX.Renderer._linesEls = [];
    AMX.Renderer._activeIndex = -1;

    if (!lines || lines.length === 0) {
      var empty = document.createElement("div");
      empty.className = "lrcinject-empty";
      empty.textContent = "No lyrics loaded";
      container.appendChild(empty);
      return;
    }

    var padTop = document.createElement("div");
    padTop.className = "lrcinject-spacer";
    container.appendChild(padTop);

    for (var i = 0; i < lines.length; i++) {
      var el = document.createElement("div");
      el.className = "lrcinject-line";
      el.setAttribute("data-index", i);

      if (lines[i].words && lines[i].words.length > 0) {
        el.classList.add("lrcinject-line--worded");
        for (var w = 0; w < lines[i].words.length; w++) {
          var word = document.createElement("span");
          word.className = "lrcinject-word";
          word.textContent = lines[i].words[w].text;
          word.setAttribute("data-word-index", w);
          el.appendChild(word);
          if (w < lines[i].words.length - 1) {
            el.appendChild(document.createTextNode(" "));
          }
        }
      } else {
        el.textContent = lines[i].text;
      }

      el.addEventListener("click", (function (idx) {
        return function () {
          var line = AMX.SyncEngine.getLines()[idx];
          if (line) {
            var audio = AMX.SyncEngine._getAudio();
            if (audio) {
              audio.currentTime = Math.max(0, line.start - (AMX.SyncEngine.getUserOffset() || 0));
            }
          }
        };
      })(i));

      container.appendChild(el);
      AMX.Renderer._linesEls.push(el);
    }

    var padBot = document.createElement("div");
    padBot.className = "lrcinject-spacer";
    container.appendChild(padBot);

    AMX.log("Rendered", lines.length, "lyric lines");
  },

  updateActiveLine: function (index, currentTime) {
    var lineChanged = index !== AMX.Renderer._activeIndex;

    if (lineChanged) {
      AMX.Renderer._activeIndex = index;
      var els = AMX.Renderer._linesEls;

      for (var i = 0; i < els.length; i++) {
        els[i].classList.remove("is-active", "is-near", "is-far");
      }

      if (index >= 0 && index < els.length) {
        els[index].classList.add("is-active");

        if (index - 1 >= 0) els[index - 1].classList.add("is-near");
        if (index + 1 < els.length) els[index + 1].classList.add("is-near");

        if (index - 2 >= 0) els[index - 2].classList.add("is-near");
        if (index + 2 < els.length) els[index + 2].classList.add("is-near");

        for (var p = 0; p < index - 2; p++) {
          els[p].classList.add("is-far");
        }
        for (var f = index + 3; f < els.length; f++) {
          els[f].classList.add("is-far");
        }
      }

      AMX.Renderer._scrollToActive(index);
    }

    AMX.Renderer._updateWordHighlight(index, currentTime);
  },

  _scrollToActive: function (index) {
    var el = AMX.Renderer._linesEls[index];
    if (!el || !AMX.Renderer._linesContainer) return;

    var container = AMX.Renderer._linesContainer;
    var containerH = container.clientHeight;
    var elTop = el.offsetTop;
    var elH = el.offsetHeight;
    var targetScroll = elTop - containerH * 0.4 + elH / 2;

    container.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: "smooth",
    });
  },

  _updateWordHighlight: function (lineIndex, currentTime) {
    var lines = AMX.SyncEngine.getLines();
    if (!lines || !lines[lineIndex] || !lines[lineIndex].words) return;

    var line = lines[lineIndex];
    var els = AMX.Renderer._linesEls;
    if (!els[lineIndex]) return;

    var wordEls = els[lineIndex].querySelectorAll(".lrcinject-word");
    var offset = AMX.SyncEngine.getUserOffset() || 0;
    var t = currentTime + offset;

    for (var w = 0; w < line.words.length; w++) {
      var word = line.words[w];
      var wordEl = wordEls[w];
      if (!wordEl) continue;

      if (t >= word.start && t < word.end) {
        var progress = (t - word.start) / (word.end - word.start);
        wordEl.style.setProperty("--word-progress", Math.round(progress * 100) + "%");
        wordEl.classList.add("is-active-word");
        wordEl.classList.remove("is-past-word");
      } else if (t >= word.end) {
        wordEl.style.setProperty("--word-progress", "100%");
        wordEl.classList.remove("is-active-word");
        wordEl.classList.add("is-past-word");
      } else {
        wordEl.style.setProperty("--word-progress", "0%");
        wordEl.classList.remove("is-active-word", "is-past-word");
      }
    }
  },

  show: function () {
    if (!AMX.Renderer._root) return;
    AMX.Renderer._root.classList.add("is-visible");
    AMX.Renderer._visible = true;
    if (AMX.Renderer._toggleBtn) {
      AMX.Renderer._toggleBtn.classList.add("is-active");
    }
    AMX.log("Overlay shown");
  },

  hide: function () {
    if (!AMX.Renderer._root) return;
    AMX.Renderer._root.classList.remove("is-visible");
    AMX.Renderer._visible = false;
    if (AMX.Renderer._toggleBtn) {
      AMX.Renderer._toggleBtn.classList.remove("is-active");
    }
    AMX.log("Overlay hidden");
  },

  isVisible: function () {
    return AMX.Renderer._visible;
  },
};
