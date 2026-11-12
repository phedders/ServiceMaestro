(() => {
  const target = document.body.dataset.target || "main";
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "dev-output";
  const root = document.getElementById("sm-root");
  const backgroundLayer = document.createElement("div");
  backgroundLayer.id = "sm-background-layer";
  document.body.prepend(backgroundLayer);
  const stingerLayer = document.createElement("div");
  stingerLayer.id = "sm-stinger-layer";
  document.body.appendChild(stingerLayer);
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
  const FADE_CLASS = target === "main" ? "sm-text-fading" : "sm-fading";
  const HEARTBEAT_TIMEOUT_MS = 45_000;
  const HEARTBEAT_CHECK_MS = 5_000;
  let lastHeartbeat = Date.now();
  let lastHtml = "";
  let lastCss = "";
  let lastBackground = "";
  let fadeTimer = null;
  let stingerCommitTimer = null;
  let stingerEndTimer = null;
  let pendingStingerPage = "";
  let displayedPageKey = "";

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

  function currentPageKey(state) {
    const page = state.pages && state.pages[state.pageIndex];
    if (!page || state.mode === "idle") return "";
    return `${state.setlistId || ""}:${state.itemIndex}:${state.pageIndex}`;
  }

  function cancelFade() {
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = null;
    document.body.classList.remove("sm-fading", "sm-text-fading");
  }

  function cancelStinger() {
    if (stingerCommitTimer) clearTimeout(stingerCommitTimer);
    if (stingerEndTimer) clearTimeout(stingerEndTimer);
    stingerCommitTimer = null;
    stingerEndTimer = null;
    stingerLayer.classList.remove("playing");
    stingerLayer.innerHTML = "";
    pendingStingerPage = "";
  }

  function playStinger(stinger, pageKey, commit) {
    cancelFade();
    cancelStinger();
    const duration = Math.max(200, Number(stinger.durationMs) || 1000);
    const coverAt = Math.max(120, Math.round(duration * 0.45));
    pendingStingerPage = pageKey;
    // Restart the inline SVG animation from the beginning.
    stingerLayer.innerHTML = "";
    void stingerLayer.offsetWidth;
    stingerLayer.innerHTML = stinger.render;
    stingerLayer.classList.add("playing");
    stingerCommitTimer = setTimeout(() => {
      stingerCommitTimer = null;
      commit();
    }, coverAt);
    stingerEndTimer = setTimeout(() => {
      stingerEndTimer = null;
      stingerLayer.classList.remove("playing");
      stingerLayer.innerHTML = "";
      pendingStingerPage = "";
    }, duration);
  }

  function swapHtml(html) {
    if (target === "main" && root.firstElementChild?.classList.contains("sm-template")) {
      const parsed = document.createElement("template");
      parsed.innerHTML = html;
      const nextTemplate = parsed.content.firstElementChild;
      const currentTemplate = root.firstElementChild;
      const currentPanel = currentTemplate.querySelector(".sm-lowerthird-panel");
      const nextPanel = nextTemplate?.querySelector(".sm-lowerthird-panel");
      const currentContent = currentPanel?.querySelector(".sm-content");
      const nextContent = nextPanel?.querySelector(".sm-content");
      const currentFooter = currentPanel?.querySelector(".sm-footer");
      const nextFooter = nextPanel?.querySelector(".sm-footer");
      if (
        nextTemplate &&
        nextTemplate.classList.contains("sm-template") &&
        currentPanel &&
        nextPanel &&
        currentContent &&
        nextContent
      ) {
        currentTemplate.className = nextTemplate.className;
        currentPanel.className = nextPanel.className;
        currentContent.className = nextContent.className;
        currentContent.innerHTML = nextContent.innerHTML;
        if (currentFooter && nextFooter) {
          currentFooter.className = nextFooter.className;
          currentFooter.innerHTML = nextFooter.innerHTML;
        } else if (currentFooter && !nextFooter) {
          currentFooter.remove();
        } else if (!currentFooter && nextFooter) {
          currentPanel.appendChild(nextFooter);
        }
        return;
      }
    }
    root.innerHTML = html;
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
    const pageKey = currentPageKey(state);
    const pageChanged = Boolean(pageKey && displayedPageKey && pageKey !== displayedPageKey);
    const stinger =
      (target === "full" || target === "two_thirds") && !blank && page ? page.stinger : null;
    const backgroundHtml = target === "main" ? "" : state.background?.render || "";
    const applyBackground = () => {
      if (backgroundHtml === lastBackground) return;
      backgroundLayer.innerHTML = backgroundHtml;
      lastBackground = backgroundHtml;
    };
    const deferBackground = Boolean(pageChanged && stinger && root.innerHTML);
    if (!deferBackground) applyBackground();

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
    const sameContent = html === lastHtml && template.css === lastCss;

    if (pendingStingerPage && pendingStingerPage === pageKey) {
      if (!blank && page) return;
      cancelStinger();
    }
    if (blank || !page) cancelStinger();
    if (sameContent && pageKey === displayedPageKey) return;
    if (sameContent && pageChanged && !stinger) {
      displayedPageKey = pageKey;
      return;
    }

    const commit = () => {
      applyBackground();
      if (template.css !== lastCss) {
        style.textContent = template.css;
        lastCss = template.css;
      }
      swapHtml(html);
      lastHtml = html;
      displayedPageKey = pageKey;
      // Paint the new text at zero opacity before fading back in.
      requestAnimationFrame(() => {
        requestAnimationFrame(() =>
          document.body.classList.remove("sm-fading", "sm-text-fading"),
        );
      });
    };

    if (pageChanged && stinger && root.innerHTML) {
      playStinger(stinger, pageKey, commit);
      return;
    }

    cancelStinger();
    if (root.innerHTML) {
      document.body.classList.add(FADE_CLASS);
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
