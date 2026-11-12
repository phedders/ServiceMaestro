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

  function tarpLayerSelector() {
    return target === "main" ? ".tarp-lowerthird-layer" : ".tarp-normal-layer";
  }

  function tarpTransform(base, value) {
    return base && base !== "none" ? `${value} ${base}` : value;
  }

  function applyTarpAnimations(element) {
    let animations = [];
    try {
      animations = JSON.parse(element.dataset.tarpAnimations || "[]");
    } catch {
      animations = [];
    }
    if (!Array.isArray(animations)) return;
    const naturalOpacity = getComputedStyle(element).opacity;
    const baseTransform = element.style.transform || "none";
    for (const animation of animations) {
      const duration = Math.max(0, Number(animation?.durationMs) || 0);
      if (!duration) continue;
      const options = {
        delay: Math.max(0, Number(animation?.delayMs) || 0),
        duration,
        easing: animation?.easing || "ease",
        fill: "both",
      };
      if (animation.type === "fade-in") {
        element.animate([{ opacity: 0 }, { opacity: naturalOpacity }], options);
      } else if (animation.type === "fade-out") {
        element.animate([{ opacity: naturalOpacity }, { opacity: 0 }], options);
      } else if (animation.type === "slide-in") {
        element.animate(
          [
            { transform: tarpTransform(baseTransform, "translateY(8%)") },
            { transform: baseTransform },
          ],
          options,
        );
      } else if (animation.type === "move") {
        element.animate(
          [
            { transform: tarpTransform(baseTransform, "translateX(-6%)") },
            { transform: baseTransform },
          ],
          options,
        );
      } else if (animation.type === "scale") {
        element.animate(
          [
            { transform: tarpTransform(baseTransform, "scale(0.82)") },
            { transform: baseTransform },
          ],
          options,
        );
      } else if (animation.type === "rotate") {
        element.animate(
          [
            { transform: tarpTransform(baseTransform, "rotate(-10deg)") },
            { transform: baseTransform },
          ],
          options,
        );
      }
    }
  }

  function swapTarpRoot(nextTemplate, animate) {
    const oldTarp = root.querySelector(".tarp-page-root");
    const newTarp = nextTemplate.querySelector(".tarp-page-root");
    if (!oldTarp || !newTarp) return false;
    const selector = tarpLayerSelector();
    const oldCanvas = oldTarp.querySelector(`${selector} .tarp-canvas`);
    const newCanvas = newTarp.querySelector(`${selector} .tarp-canvas`);
    if (!oldCanvas || !newCanvas) return false;

    const oldObjects = new Map();
    if (animate) {
      const canvasRect = oldCanvas.getBoundingClientRect();
      oldCanvas.querySelectorAll("[data-tarp-object-id]").forEach((element) => {
        const rect = element.getBoundingClientRect();
        oldObjects.set(element.dataset.tarpObjectId, {
          x: rect.left - canvasRect.left,
          y: rect.top - canvasRect.top,
          width: rect.width,
          height: rect.height,
          opacity: Number(getComputedStyle(element).opacity),
        });
      });
    }

    // Keep an unchanged Tarp background node alive across the swap so CSS/SVG
    // animations do not restart and the background never fades.
    const oldBackground = oldCanvas.querySelector(":scope > .tarp-background");
    const newBackground = newCanvas.querySelector(":scope > .tarp-background");
    if (
      oldBackground &&
      newBackground &&
      oldCanvas.dataset.tarpBg === newCanvas.dataset.tarpBg
    ) {
      newBackground.replaceWith(oldBackground);
    }

    const newObjects = Array.from(newCanvas.querySelectorAll("[data-tarp-object-id]"));
    for (const element of newObjects) element.style.visibility = "hidden";
    root.replaceChildren(nextTemplate);
    if (!animate) {
      for (const element of newObjects) element.style.visibility = "";
      return true;
    }

    const mode = newTarp.dataset.tarpObjectMode || "animate";
    const duration = Math.max(1, Number(newTarp.dataset.tarpDuration) || 500);
    const easing = newTarp.dataset.tarpEasing || "ease";
    const newCanvasRect = newCanvas.getBoundingClientRect();

    for (const element of newObjects) {
      const naturalOpacity = element.style.opacity || "1";
      const baseTransform = element.style.transform || "none";
      const naturalTransformOrigin = element.style.transformOrigin;
      const old = oldObjects.get(element.dataset.tarpObjectId);
      element.style.visibility = "";
      if (mode === "migrate" && old) {
        const rect = element.getBoundingClientRect();
        const dx = old.x - (rect.left - newCanvasRect.left);
        const dy = old.y - (rect.top - newCanvasRect.top);
        const sx = rect.width > 0 ? old.width / rect.width : 1;
        const sy = rect.height > 0 ? old.height / rect.height : 1;
        const initial = tarpTransform(
          baseTransform,
          `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
        );
        element.style.transformOrigin = "top left";
        element.style.transform = initial;
        element.style.opacity = String(old.opacity);
        const animation = element.animate(
          [
            { transform: initial, opacity: old.opacity },
            { transform: baseTransform, opacity: Number(naturalOpacity) },
          ],
          { duration, easing, fill: "both" },
        );
        animation.onfinish = () => {
          animation.cancel();
          element.style.transform = baseTransform;
          element.style.transformOrigin = naturalTransformOrigin;
          element.style.opacity = naturalOpacity;
        };
      } else if (mode === "migrate") {
        const initial = tarpTransform(baseTransform, "scale(0.96)");
        element.style.transform = initial;
        element.style.opacity = "0";
        const animation = element.animate(
          [
            { transform: initial, opacity: 0 },
            { transform: baseTransform, opacity: Number(naturalOpacity) },
          ],
          { duration, easing, fill: "both" },
        );
        animation.onfinish = () => {
          animation.cancel();
          element.style.transform = baseTransform;
          element.style.opacity = naturalOpacity;
        };
      } else {
        applyTarpAnimations(element);
      }
    }
    return true;
  }

  function swapHtml(html, animateTarp = false) {
    const parsed = document.createElement("template");
    parsed.innerHTML = html;
    const nextTemplate = parsed.content.firstElementChild;
    if (
      nextTemplate?.classList.contains("sm-template") &&
      root.querySelector(".tarp-page-root") &&
      nextTemplate.querySelector(".tarp-page-root") &&
      swapTarpRoot(nextTemplate, animateTarp)
    ) {
      return;
    }
    if (target === "main" && root.firstElementChild?.classList.contains("sm-template")) {
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
    document.body.classList.toggle("mode-tarp", state.mode === "tarp");
    const pageKey = currentPageKey(state);
    const pageChanged = Boolean(pageKey && displayedPageKey && pageKey !== displayedPageKey);
    const tarpPageChange = Boolean(
      pageChanged &&
        page?.html?.includes("tarp-page-root") &&
        root.querySelector(".tarp-page-root"),
    );
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
      swapHtml(html, tarpPageChange);
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
    if (tarpPageChange) {
      commit();
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
