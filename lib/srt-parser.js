var AMX = window.AMX || {};
window.AMX = AMX;

AMX.SrtParser = {
  parseTimestamp: function (ts) {
    var parts = ts.trim().split(":");
    if (parts.length < 3) return 0;
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    var secParts = parts[2].replace(",", ".").split(".");
    var seconds = parseInt(secParts[0], 10);
    var ms = secParts[1] ? parseInt(secParts[1].padEnd(3, "0"), 10) : 0;
    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
  },

  parse: function (rawText) {
    var blocks = rawText.trim().split(/\r?\n\r?\n/);
    var result = [];

    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var lines = block.split(/\r?\n/);
      if (lines.length < 2) continue;

      var timeLine = null;
      var timeLineIdx = -1;
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].indexOf("-->") !== -1) {
          timeLine = lines[j];
          timeLineIdx = j;
          break;
        }
      }
      if (!timeLine) continue;

      var timeParts = timeLine.split("-->");
      var start = AMX.SrtParser.parseTimestamp(timeParts[0]);
      var end = AMX.SrtParser.parseTimestamp(timeParts[1]);

      var textLines = [];
      for (var k = timeLineIdx + 1; k < lines.length; k++) {
        var t = lines[k].trim();
        if (t) textLines.push(t);
      }
      var text = textLines.join(" ");
      if (!text) continue;

      result.push({ start: start, end: end, text: text });
    }

    result.sort(function (a, b) {
      return a.start - b.start;
    });

    return result;
  },
};
