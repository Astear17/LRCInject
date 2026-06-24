var AMX = window.AMX || {};
window.AMX = AMX;

AMX.isExtensionContextValid = function () {
  try {
    return Boolean(
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.id
    );
  } catch (e) {
    return false;
  }
};

AMX.isContextInvalidatedError = function (error) {
  var message = String((error && error.message) || error || "");
  return message.indexOf("Extension context invalidated") !== -1;
};

AMX.assertContext = function () {
  if (!AMX.isExtensionContextValid()) {
    throw new Error("Extension context invalidated");
  }
};
