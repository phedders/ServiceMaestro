(() => {
  const target = document.body.dataset.target || "main";
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "dev-output";
  const root = document.getElementById("sm-root");
  const style = document.createElement("style");
  style.id = "sm-template-style";
  document.head.appendChild(style);

  const socket = window.io({
    path: "/display/socket.ro.io",
    auth: { outputToken: token },
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
  });

  const FADE_MS = 240;
  const HEARTBEAT_TIMEOUT_MS = 45_000;
  const HEARTBEAT_CHECK_MS = 5_000;
  let lastHeartbeat = Date.now();
  let lastHtml = "";
  let lastCss = "";
  let fadeTimer = null;

  function checkHeartbeat() {
    if (document.visibilityState === "hidden") return;
    if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      window.location.reload();
    }
  }

  setInterval(checkHeartbeat, HEARTBEAT_CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkHeartbeat();
  });

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function templateFor(state) {
    const templates = state.templates || {};
    return (
      templates[target] ||
      (target === "full" ? templates.two_thirds : null) ||
      templates.main || {
        html: '<div class="sm-template"><div class="sm-content">{{content}}</div><div class="sm-footer">{{footer}}</div></div>',
        css: "",
      }
    );
  }

  function compose(state, template) {
    const page = state.pages && state.pages[state.pageIndex];
    const pageNumber = page ? state.pageIndex + 1 : 0;
    const livePages =
      target === "stage" || target === "chords"
        ? (state.pages || [])
            .slice(state.pageIndex)
            .map((item, offset) => {
              const isCurrent = offset === 0;
              const label = isCurrent
                ? ""
                : `<div class="sm-page-label">Page ${item.index + 1}</div>`;
              return `<div class="sm-page ${isCurrent ? "sm-page-current" : "sm-page-upcoming"}">${label}${item.html}</div>`;
            })
            .join("")
        : page
          ? page.html
          : "";
    const isImage = state.mode === "image" || state.mode === "image_list";
    const replacements = {
      content: livePages,
      footer: escapeHtml(state.footer || ""),
      title: isImage ? "" : escapeHtml(state.title || ""),
      section: isImage ? "" : escapeHtml(page?.section || ""),
      page: String(pageNumber),
      pageCount: String(state.pageCount || 0),
      role: target,
      meta: page && !isImage ? ` · ${pageNumber} / ${state.pageCount}` : "",
    };
    return template.html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) =>
      Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : "",
    );
  }

  function apply(state) {
    const page = state.pages && state.pages[state.pageIndex];
    const idle = !page || state.mode === "idle";
    const blank = Boolean(state.blank) || idle;
    document.body.classList.toggle("blank", blank);
    document.body.classList.toggle("idle", idle);
    document.body.classList.toggle(
      "mode-image",
      state.mode === "image" || state.mode === "image_list",
    );

    const config = state.displayConfig || {};
    if (target === "main" || target === "two_thirds" || target === "full") {
      const lowerThird = target === "main";
      root.style.setProperty(
        "--sm-text-scale",
        String(
          lowerThird
            ? config.lowerThirdTextScale ?? config.textScale ?? 1
            : config.textScale ?? 1,
        ),
      );
      root.style.setProperty("--sm-text-color", config.textColor || "#ffffff");
      root.style.setProperty(
        "--sm-font-family",
        (lowerThird
          ? config.lowerThirdFontFamily || config.fontFamily
          : config.fontFamily) ||
          '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
      );
      root.style.setProperty(
        "--sm-lowerthird-image-max-height",
        `${config.lowerThirdImageMaxHeightPercent ?? 30}vh`,
      );
      const lowerThirdPadding = `${config.lowerThirdImagePadding ?? 48}px`;
      root.style.setProperty("--sm-lowerthird-padding", lowerThirdPadding);
      root.style.setProperty("--sm-lowerthird-image-padding", lowerThirdPadding);
    } else {
      root.style.removeProperty("--sm-text-scale");
      root.style.removeProperty("--sm-text-color");
      root.style.removeProperty("--sm-font-family");
    }

    const template = templateFor(state);
    const html = compose(state, template);
    if (html === lastHtml && template.css === lastCss) return;

    const commit = () => {
      if (template.css !== lastCss) {
        style.textContent = template.css;
        lastCss = template.css;
      }
      root.innerHTML = html;
      lastHtml = html;
      // Paint the new text at zero opacity before fading back in.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => document.body.classList.remove("sm-fading"));
      });
    };

    if (root.innerHTML) {
      document.body.classList.add("sm-fading");
      if (fadeTimer) clearTimeout(fadeTimer);
      // Wait for the fade-out to finish before swapping the text.
      fadeTimer = setTimeout(commit, FADE_MS);
    } else {
      commit();
    }
  }

  socket.on("live:snapshot", apply);
  socket.on("heartbeat", () => {
    lastHeartbeat = Date.now();
  });
  socket.on("connect", () => {
    lastHeartbeat = Date.now();
    document.body.classList.remove("offline");
  });
  socket.on("disconnect", () => document.body.classList.add("offline"));
  socket.on("connect_error", () => document.body.classList.add("offline"));

  window.addEventListener("keydown", (event) => {
    if (event.key === "b" || event.key === "B") {
      document.body.classList.toggle("blank");
    }
  });
})();
