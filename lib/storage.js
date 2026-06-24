var AMX = window.AMX || {};
window.AMX = AMX;

AMX.Storage = {
  BINDINGS_KEY: "lyricsBindings",
  SETTINGS_KEY: "amx_settings",

  _safeGet: function (key, fallback) {
    return new Promise(function (resolve) {
      try {
        if (!AMX.isExtensionContextValid()) {
          AMX.warn("extension context invalid, storage.get skipped");
          resolve(fallback);
          return;
        }

        chrome.storage.local.get(key, function (data) {
          var err = chrome.runtime.lastError;
          if (err) {
            AMX.warn("storage.get failed:", err.message);
            resolve(fallback);
            return;
          }
          resolve((data && data[key] != null) ? data[key] : fallback);
        });
      } catch (error) {
        if (AMX.isContextInvalidatedError(error)) {
          AMX.warn("extension context invalidated during storage.get");
          resolve(fallback);
          return;
        }
        AMX.warn("storage.get unexpected error:", error);
        resolve(fallback);
      }
    });
  },

  _safeSet: function (data) {
    return new Promise(function (resolve) {
      try {
        if (!AMX.isExtensionContextValid()) {
          AMX.warn("extension context invalid, storage.set skipped");
          resolve(false);
          return;
        }

        chrome.storage.local.set(data, function () {
          var err = chrome.runtime.lastError;
          if (err) {
            AMX.warn("storage.set failed:", err.message);
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch (error) {
        if (AMX.isContextInvalidatedError(error)) {
          AMX.warn("extension context invalidated during storage.set");
          resolve(false);
          return;
        }
        AMX.warn("storage.set unexpected error:", error);
        resolve(false);
      }
    });
  },

  getBindings: function () {
    return AMX.Storage._safeGet(AMX.Storage.BINDINGS_KEY, {});
  },

  getBinding: function (trackKey) {
    return AMX.Storage.getBindings().then(function (bindings) {
      return bindings[trackKey] || null;
    });
  },

  saveBinding: function (trackKey, binding) {
    return AMX.Storage.getBindings().then(function (bindings) {
      bindings[trackKey] = binding;
      return AMX.Storage._safeSet({ [AMX.Storage.BINDINGS_KEY]: bindings });
    });
  },

  removeBinding: function (trackKey) {
    return AMX.Storage.getBindings().then(function (bindings) {
      delete bindings[trackKey];
      return AMX.Storage._safeSet({ [AMX.Storage.BINDINGS_KEY]: bindings });
    });
  },

  getSettings: function () {
    return AMX.Storage._safeGet(AMX.Storage.SETTINGS_KEY, {
      useCustomOverNative: false,
      overlayEnabled: true,
    });
  },

  saveSettings: function (settings) {
    return AMX.Storage._safeSet({ [AMX.Storage.SETTINGS_KEY]: settings });
  },

  createBinding: function (trackKey, title, artist, duration, fileName, sourceType, rawText, parsedLines) {
    var now = Date.now();
    return {
      id: AMX.generateId(),
      trackKey: trackKey,
      title: title || "",
      artist: artist || "",
      duration: duration || 0,
      fileName: fileName || "",
      sourceType: sourceType,
      rawText: rawText,
      parsedLines: parsedLines,
      userOffset: 0,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
  },
};
