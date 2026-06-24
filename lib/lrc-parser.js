var AMX = window.AMX || {};
window.AMX = AMX;

AMX.LrcParser = {
  parse: function (rawText) {
    var lines = [];
    var rows = String(rawText || "").replace(/\r/g, "").split("\n");

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var matches = [];
      var timeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
      var match;

      while ((match = timeRegex.exec(row)) !== null) {
        matches.push(match);
      }

      if (matches.length === 0) continue;

      var textAfterTimestamps = row.replace(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g, "").trim();
      if (!textAfterTimestamps) continue;

      var hasAngleTags = /<\d{1,2}:\d{2}[.:]\d{2}>/.test(textAfterTimestamps);
      var words = null;
      var displayText = textAfterTimestamps;

      if (hasAngleTags) {
        words = AMX.LrcParser._parseWordTags(textAfterTimestamps);
        displayText = AMX.LrcParser._reconstructText(words);
      }

      for (var j = 0; j < matches.length; j++) {
        var m = matches[j];
        var min = Number(m[1]);
        var sec = Number(m[2]);
        var fracRaw = m[3] || "0";
        var frac =
          fracRaw.length === 1 ? Number(fracRaw) / 10 :
          fracRaw.length === 2 ? Number(fracRaw) / 100 :
          Number(fracRaw) / 1000;

        var line = {
          start: min * 60 + sec + frac,
          text: displayText,
        };

        if (words && words.length > 0) {
          line.words = [];
          for (var k = 0; k < words.length; k++) {
            line.words.push({
              text: words[k].text,
              start: words[k].start,
              end: words[k].end
            });
          }
        }

        lines.push(line);
      }
    }

    lines.sort(function (a, b) {
      return a.start - b.start;
    });

    for (var k = 0; k < lines.length; k++) {
      lines[k].end = lines[k + 1] ? lines[k + 1].start : Infinity;
    }

    // Fill in word end times where missing
    for (var li = 0; li < lines.length; li++) {
      if (!lines[li].words) continue;
      var wds = lines[li].words;
      for (var wi = 0; wi < wds.length; wi++) {
        if (wds[wi].end === undefined || wds[wi].end === null) {
          wds[wi].end = wds[wi + 1] ? wds[wi + 1].start : lines[li].end;
        }
      }
    }

    return lines;
  },

  _parseWordTags: function (textWithTags) {
    var words = [];
    var remaining = textWithTags;
    var wordTagRe = /<(\d{1,2}):(\d{2})[.:](\d{2})>/;

    while (remaining.length > 0) {
      var m = remaining.match(wordTagRe);
      if (!m || m.index === undefined) break;

      if (m.index > 0) {
        var before = remaining.substring(0, m.index);
        if (before.trim()) {
          words.push({ text: before.trim(), start: null, end: null });
        }
      }

      var min = Number(m[1]);
      var sec = Number(m[2]);
      var fracRaw = m[3] || "0";
      var frac =
        fracRaw.length === 1 ? Number(fracRaw) / 10 :
        fracRaw.length === 2 ? Number(fracRaw) / 100 :
        Number(fracRaw) / 1000;
      var ts = min * 60 + sec + frac;

      remaining = remaining.substring(m.index + m[0].length);

      // Collect text until next tag or end
      var nextTagIdx = remaining.search(wordTagRe);
      var wordText;
      if (nextTagIdx === -1) {
        wordText = remaining;
        remaining = "";
      } else {
        wordText = remaining.substring(0, nextTagIdx);
        remaining = remaining.substring(nextTagIdx);
      }

      // Split leading/trailing spaces from the word text
      var trimmed = wordText.replace(/^\s+/, "").replace(/\s+$/, "");
      if (trimmed) {
        words.push({ text: trimmed, start: ts, end: null });
      }
    }

    // Handle any remaining text after last tag
    if (remaining.trim()) {
      words.push({ text: remaining.trim(), start: null, end: null });
    }

    // Fill in end times from next word's start
    for (var i = 0; i < words.length; i++) {
      if (words[i].start !== null && (words[i].end === null || words[i].end === undefined)) {
        for (var j = i + 1; j < words.length; j++) {
          if (words[j].start !== null) {
            words[i].end = words[j].start;
            break;
          }
        }
      }
    }

    // Remove words with no start time (leading/trailing fragments without timestamps)
    return words.filter(function (w) { return w.start !== null; });
  },

  _reconstructText: function (words) {
    var parts = [];
    for (var i = 0; i < words.length; i++) {
      parts.push(words[i].text);
    }
    return parts.join(" ");
  },
};
