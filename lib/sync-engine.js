var AMX = window.AMX || {};
window.AMX = AMX;

AMX.SyncEngine = {
  _lines: null,
  _activeIndex: -1,
  _userOffset: 0,
  _running: false,
  _rafId: null,
  _onUpdate: null,
  _onLineChange: null,

  load: function (lines, userOffset) {
    AMX.SyncEngine._lines = lines || [];
    AMX.SyncEngine._userOffset = userOffset || 0;
    AMX.SyncEngine._activeIndex = -1;
    AMX.log("Sync engine loaded", lines ? lines.length : 0, "lines");
  },

  setUserOffset: function (offset) {
    AMX.SyncEngine._userOffset = offset || 0;
  },

  setCallback: function (fn) {
    AMX.SyncEngine._onUpdate = fn;
  },

  setLineChangeCallback: function (fn) {
    AMX.SyncEngine._onLineChange = fn;
  },

  start: function () {
    if (AMX.SyncEngine._running) return;
    AMX.SyncEngine._running = true;
    AMX.SyncEngine._tick();
    AMX.log("Sync engine started");
  },

  stop: function () {
    AMX.SyncEngine._running = false;
    if (AMX.SyncEngine._rafId) {
      cancelAnimationFrame(AMX.SyncEngine._rafId);
      AMX.SyncEngine._rafId = null;
    }
  },

  getActiveIndex: function () {
    return AMX.SyncEngine._activeIndex;
  },

  getLines: function () {
    return AMX.SyncEngine._lines;
  },

  getUserOffset: function () {
    return AMX.SyncEngine._userOffset;
  },

  getCurrentTime: function () {
    var audio = AMX.SyncEngine._getAudio();
    return audio ? audio.currentTime : 0;
  },

  _getAudio: function () {
    var audios = document.querySelectorAll("audio");
    for (var i = 0; i < audios.length; i++) {
      if (!audios[i].paused || audios[i].currentTime > 0) {
        return audios[i];
      }
    }
    return audios.length > 0 ? audios[0] : null;
  },

  getActiveLineIndex: function (lines, currentTime, offset) {
    if (!lines || lines.length === 0) return -1;
    var t = currentTime + offset;
    for (var i = lines.length - 1; i >= 0; i--) {
      var current = lines[i];
      var next = lines[i + 1];
      var end = current.end !== undefined ? current.end : (next ? next.start : Infinity);
      if (t >= current.start && t < end) {
        return i;
      }
    }
    if (t < lines[0].start) return -1;
    return lines.length - 1;
  },

  _tick: function () {
    if (!AMX.SyncEngine._running) return;

    var audio = AMX.SyncEngine._getAudio();
    if (audio && AMX.SyncEngine._lines) {
      var currentTime = audio.currentTime;
      var newIdx = AMX.SyncEngine.getActiveLineIndex(
        AMX.SyncEngine._lines,
        currentTime,
        AMX.SyncEngine._userOffset
      );

      var lineChanged = newIdx !== AMX.SyncEngine._activeIndex;
      AMX.SyncEngine._activeIndex = newIdx;

      if (AMX.SyncEngine._onUpdate) {
        AMX.SyncEngine._onUpdate(newIdx, currentTime, lineChanged);
      }

      if (lineChanged && AMX.SyncEngine._onLineChange) {
        AMX.SyncEngine._onLineChange(newIdx, currentTime);
      }
    }

    AMX.SyncEngine._rafId = requestAnimationFrame(AMX.SyncEngine._tick);
  },

  destroy: function () {
    AMX.SyncEngine.stop();
    AMX.SyncEngine._lines = null;
    AMX.SyncEngine._activeIndex = -1;
    AMX.SyncEngine._onUpdate = null;
    AMX.SyncEngine._onLineChange = null;
  },
};
