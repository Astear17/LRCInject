var AMX = window.AMX || {};
window.AMX = AMX;

AMX.TrackDetector = {
  _lastKey: null,
  _lastTitle: null,
  _lastArtist: null,
  _lastDuration: null,
  _listeners: [],

  detect: function (playerState) {
    var title = playerState.title || "";
    var artist = playerState.artist || "";
    var duration = playerState.duration || 0;

    if (!title && !artist) return null;

    var catalogId = AMX.TrackDetector._extractCatalogId();
    var key;
    if (catalogId) {
      key = "amxid:" + catalogId;
    } else {
      key = AMX.makeTrackKey(title, artist, duration);
    }

    return {
      key: key,
      title: title,
      artist: artist,
      duration: duration,
      catalogId: catalogId,
    };
  },

  _extractCatalogId: function () {
    var url = window.location.href;
    var match = url.match(/\/album\/[^/]+\/(\d+)/);
    if (match) {
      var songMatch = url.match(/[?&]i=(\d+)/);
      if (songMatch) return songMatch[1];
    }
    var pathMatch = url.match(/\/song\/[^/]+\/(\d+)/);
    if (pathMatch) return pathMatch[1];

    try {
      var mk =
        typeof MusicKit !== "undefined" && MusicKit.getInstance
          ? MusicKit.getInstance()
          : null;
      if (mk && mk.nowPlayingItem) {
        var item = mk.nowPlayingItem;
        if (item.id) return String(item.id);
        if (item.attributes?.playParams?.catalogId)
          return String(item.attributes.playParams.catalogId);
        if (item.playParams?.catalogId)
          return String(item.playParams.catalogId);
      }
    } catch (e) {}

    return null;
  },

  checkForChange: function (playerState) {
    if (!AMX.isExtensionContextValid()) return null;

    var track = AMX.TrackDetector.detect(playerState);
    if (!track || !track.key) return null;

    if (track.key !== AMX.TrackDetector._lastKey) {
      var prev = AMX.TrackDetector._lastKey;
      AMX.TrackDetector._lastKey = track.key;
      AMX.TrackDetector._lastTitle = track.title;
      AMX.TrackDetector._lastArtist = track.artist;
      AMX.TrackDetector._lastDuration = track.duration;
      AMX.log("Track changed:", track.title, "-", track.artist);
      for (var i = 0; i < AMX.TrackDetector._listeners.length; i++) {
        try {
          AMX.TrackDetector._listeners[i](track, prev);
        } catch (err) {
          AMX.warn("Track listener error:", err);
        }
      }
      return track;
    }

    return null;
  },

  getCurrentTrack: function () {
    if (!AMX.TrackDetector._lastKey) return null;
    return {
      key: AMX.TrackDetector._lastKey,
      title: AMX.TrackDetector._lastTitle,
      artist: AMX.TrackDetector._lastArtist,
      duration: AMX.TrackDetector._lastDuration,
    };
  },

  onTrackChange: function (callback) {
    AMX.TrackDetector._listeners.push(callback);
    return function () {
      var idx = AMX.TrackDetector._listeners.indexOf(callback);
      if (idx >= 0) AMX.TrackDetector._listeners.splice(idx, 1);
    };
  },

  reset: function () {
    AMX.TrackDetector._lastKey = null;
    AMX.TrackDetector._lastTitle = null;
    AMX.TrackDetector._lastArtist = null;
    AMX.TrackDetector._lastDuration = null;
  },
};
