(function () {
  var stateElement = document.getElementById("sm-preview-state");
  if (!stateElement) return;
  var state;
  try {
    state = JSON.parse(stateElement.textContent || "{}");
  } catch {
    return;
  }

  var handlers = {};
  var socket = {
    on: function (event, callback) {
      (handlers[event] = handlers[event] || []).push(callback);
      if (event === "live:snapshot") window.__smPreviewApply = callback;
    },
    once: function () {},
    emit: function () {},
    _heartbeat: function () {
      (handlers.heartbeat || []).forEach(function (callback) {
        callback();
      });
    },
  };

  window.__smPreviewState = state;
  window.__smPreviewSocket = socket;
  window.io = function () {
    return socket;
  };

  function apply() {
    if (typeof window.__smPreviewApply !== "function") return false;
    window.__smPreviewApply(state);
    return true;
  }

  window.__smPreviewGoto = function (index) {
    if (!Array.isArray(state.pages) || !state.pages.length) return;
    var next = Math.max(0, Math.min(state.pages.length - 1, index));
    if (next === state.pageIndex) return;
    state.pageIndex = next;
    state.pageCount = state.pages.length;
    state.version = (state.version || 1) + 1;
    state.updatedAt = new Date().toISOString();
    apply();
  };

  function start() {
    if (!apply()) {
      var attempts = 0;
      var timer = setInterval(function () {
        if (apply() || ++attempts > 200) clearInterval(timer);
      }, 25);
    }
    setInterval(function () {
      socket._heartbeat();
    }, 20000);
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();
