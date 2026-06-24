var AMX = window.AMX || {};
window.AMX = AMX;

AMX.JsonParser = {
  parse: function (rawText) {
    try {
      var data = JSON.parse(rawText);
      if (!Array.isArray(data)) return [];

      var result = [];
      for (var i = 0; i < data.length; i++) {
        var item = data[i];
        if (typeof item.start !== "number" || typeof item.text !== "string") continue;

        var line = {
          start: item.start,
          end: typeof item.end === "number" ? item.end : undefined,
          text: item.text,
        };

        if (Array.isArray(item.words)) {
          line.words = [];
          for (var j = 0; j < item.words.length; j++) {
            var w = item.words[j];
            if (typeof w.text === "string" && typeof w.start === "number" && typeof w.end === "number") {
              line.words.push({ text: w.text, start: w.start, end: w.end });
            }
          }
          if (line.words.length === 0) delete line.words;
        }

        result.push(line);
      }

      result.sort(function (a, b) {
        return a.start - b.start;
      });

      for (var k = 0; k < result.length - 1; k++) {
        if (result[k].end === undefined) {
          result[k].end = result[k + 1].start;
        }
      }

      return result;
    } catch (e) {
      AMX.warn("JSON parse error:", e);
      return [];
    }
  },
};
