var AMX = window.AMX || {};
window.AMX = AMX;

AMX.DEBUG = true;

AMX.log = function () {
  if (AMX.DEBUG) {
    console.log("[LRCInject]", ...arguments);
  }
};

AMX.warn = function () {
  if (AMX.DEBUG) {
    console.warn("[LRCInject]", ...arguments);
  }
};

AMX.normalizeString = function (str) {
  if (!str) return "";
  return String(str)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

AMX.generateId = function () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};

AMX.makeTrackKey = function (title, artist, duration) {
  var t = AMX.normalizeString(title);
  var a = AMX.normalizeString(artist);
  if (!t && !a) return null;
  var key = t + "::" + a;
  if (duration && isFinite(duration) && duration > 0) {
    key += "::" + Math.round(duration);
  }
  return key;
};

AMX.clamp = function (val, min, max) {
  return Math.max(min, Math.min(max, val));
};

AMX.debounce = function (fn, ms) {
  var timer;
  return function () {
    clearTimeout(timer);
    var args = arguments;
    var ctx = this;
    timer = setTimeout(function () {
      fn.apply(ctx, args);
    }, ms);
  };
};

AMX.getFileName = function (name) {
  if (!name) return "";
  var parts = name.split(".");
  if (parts.length > 1) parts.pop();
  return parts.join(".");
};

AMX.detectSourceType = function (filename, rawText) {
  if (!filename) return null;
  var ext = filename.split(".").pop().toLowerCase();
  if (ext === "lrc") return "lrc";
  if (ext === "srt") return "srt";
  if (ext === "json") {
    try {
      var d = JSON.parse(rawText);
      if (Array.isArray(d)) return "json";
    } catch (e) {}
  }
  var trimmed = (rawText || "").trim();
  if (/^\d+\s*\r?\n\d{2}:\d{2}:\d{2}/.test(trimmed)) return "srt";
  if (/\[\d{1,3}:\d{2}/.test(trimmed)) return "lrc";
  return null;
};
