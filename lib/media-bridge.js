var AMX = window.AMX || {};
window.AMX = AMX;

AMX.MediaBridge = {
  _injectScript: null,
  _listeners: [],
  _currentState: null,
  _ready: false,

  init: function () {
    if (AMX.MediaBridge._injectScript) return;

    var script = document.createElement("script");
    script.src = chrome.runtime.getURL("content/inject.js");
    script.onload = function () {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
    AMX.MediaBridge._injectScript = script;

    window.addEventListener("message", AMX.MediaBridge._onMessage);
  },

  _onMessage: function (e) {
    if (!e.data || !e.data.type) return;

    if (e.data.type === "__amx_inject_ready") {
      AMX.MediaBridge._ready = true;
      AMX.log("Media bridge ready");
      return;
    }

    if (e.data.type === "__amx_player_state") {
      AMX.MediaBridge._currentState = e.data.state;

      if (!AMX.isExtensionContextValid()) return;

      for (var i = 0; i < AMX.MediaBridge._listeners.length; i++) {
        try {
          AMX.MediaBridge._listeners[i](e.data.state);
        } catch (err) {
          AMX.warn("Listener error:", err);
        }
      }
    }
  },

  onStateUpdate: function (callback) {
    AMX.MediaBridge._listeners.push(callback);
    return function () {
      var idx = AMX.MediaBridge._listeners.indexOf(callback);
      if (idx >= 0) AMX.MediaBridge._listeners.splice(idx, 1);
    };
  },

  getState: function () {
    return AMX.MediaBridge._currentState;
  },

  requestState: function () {
    window.postMessage({ type: "__amx_request_state" }, "*");
  },

  seek: function (time) {
    window.postMessage({ type: "__amx_seek", time: time }, "*");
  },

  destroy: function () {
    AMX.MediaBridge._listeners = [];
    window.removeEventListener("message", AMX.MediaBridge._onMessage);
  },
};
