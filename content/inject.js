(function () {
  if (window.__amx_inject_loaded) return;
  window.__amx_inject_loaded = true;

  var DEBUG = true;
  function debug() {
    if (DEBUG) console.log("[LRCInject bridge]", ...arguments);
  }

  debug("Page-world bridge loaded");

  var POLL_INTERVAL = 250;
  var lastState = null;

  function getAudioElement() {
    var audios = document.querySelectorAll("audio");
    for (var i = 0; i < audios.length; i++) {
      if (!audios[i].paused || audios[i].currentTime > 0) {
        return audios[i];
      }
    }
    return audios.length > 0 ? audios[0] : null;
  }

  function getMusicKitInstance() {
    try {
      if (typeof MusicKit !== "undefined" && MusicKit.getInstance) {
        return MusicKit.getInstance();
      }
    } catch (e) {}
    return null;
  }

  function getPlayerState() {
    var audio = getAudioElement();
    var mk = getMusicKitInstance();
    var state = {
      currentTime: 0,
      duration: 0,
      paused: true,
      title: "",
      artist: "",
      album: "",
      artworkUrl: "",
      hasAudio: !!audio,
      url: window.location.href,
    };

    if (mk && mk.nowPlayingItem) {
      var item = mk.nowPlayingItem;
      state.title = item.title || (item.attributes && item.attributes.name) || "";
      state.artist =
        item.artistName ||
        (item.attributes && item.attributes.artistName) ||
        (item.attributes && item.attributes.composerName) ||
        "";
      state.album =
        item.albumName ||
        (item.attributes && item.attributes.albumName) ||
        "";
      if (
        item.attributes &&
        item.attributes.artwork &&
        item.attributes.artwork.url
      ) {
        state.artworkUrl = item.attributes.artwork.url
          .replace("{w}", "300")
          .replace("{h}", "300");
      }
      if (typeof mk.currentPlaybackTime === "number") {
        state.currentTime = mk.currentPlaybackTime;
      }
      if (
        typeof mk.currentPlaybackDuration === "number" &&
        isFinite(mk.currentPlaybackDuration)
      ) {
        state.duration = mk.currentPlaybackDuration;
      }
      state.paused = mk.isPlaying === false;
    }

    if (audio) {
      if (!state.currentTime || state.currentTime === 0) {
        state.currentTime = audio.currentTime;
      }
      if (!state.duration || !isFinite(state.duration) || state.duration === 0) {
        state.duration = audio.duration || 0;
      }
      state.paused = audio.paused;
      state.hasAudio = true;
    } else {
      state.hasAudio = false;
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

    return state;
  }

  function statesEqual(a, b) {
    if (!a || !b) return false;
    return (
      Math.abs(a.currentTime - b.currentTime) < 0.3 &&
      a.paused === b.paused &&
      a.title === b.title &&
      a.artist === b.artist
    );
  }

  function sendState() {
    var state = getPlayerState();
    window.postMessage({ type: "__amx_player_state", state: state }, "*");
  }

  function poll() {
    var state = getPlayerState();
    if (!statesEqual(state, lastState)) {
      lastState = state;
      window.postMessage(
        { type: "__amx_player_state", state: state },
        "*"
      );
    }
  }

  setInterval(poll, POLL_INTERVAL);
  debug("Polling started (", POLL_INTERVAL, "ms)");

  window.addEventListener("message", function (e) {
    if (!e.data || !e.data.type) return;

    if (e.data.type === "__amx_seek") {
      var audio = getAudioElement();
      if (audio && typeof e.data.time === "number") {
        audio.currentTime = e.data.time;
      }
      var mk = getMusicKitInstance();
      if (mk && typeof e.data.time === "number") {
        try {
          mk.seekToTime(e.data.time);
        } catch (err) {}
      }
    }

    if (e.data.type === "__amx_request_state") {
      sendState();
    }
  });

  sendState();
  window.postMessage({ type: "__amx_inject_ready" }, "*");
  debug("Bridge ready, initial state sent");
})();
