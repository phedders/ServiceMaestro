(() => {
  const target = document.body.dataset.target || "main";
  const outputId = document.body.dataset.output || target;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "dev-output";
  const root = document.getElementById("sm-root");
  const backgroundLayer = document.createElement("div");
  backgroundLayer.id = "sm-background-layer";
  document.body.prepend(backgroundLayer);
  const stingerLayer = document.createElement("div");
  stingerLayer.id = "sm-stinger-layer";
  document.body.appendChild(stingerLayer);
  const clockLayer = document.createElement("div");
  clockLayer.id = "sm-clock-layer";
  document.body.appendChild(clockLayer);
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

  let fadeMs = 240;
  let fadeMode = target === "main" ? "text" : "template";
  const HEARTBEAT_TIMEOUT_MS = 45_000;
  const HEARTBEAT_CHECK_MS = 5_000;
  let lastHeartbeat = Date.now();
  let lastHtml = "";
  let lastCss = null;
  let lastBackground = "";
  let fadeTimer = null;
  let clockSettings = null;
  let clockMode = "";
  let clockTimer = null;

  const OUTPUT_CSS = `
body[data-target="main"] { --sm-output-base-font-size: clamp(2.2rem, 4.4vw, 5.5rem); }
body[data-target="two_thirds"] { --sm-output-base-font-size: clamp(2rem, 4vw, 5.2rem); }
body[data-target="full"] { --sm-output-base-font-size: clamp(2.8rem, 5.4vw, 6.6rem); }
body[data-target="stage"] { --sm-output-base-font-size: clamp(1.6rem, 2.9vw, 3.6rem); }
body[data-target="chords"] { --sm-output-base-font-size: clamp(1.7rem, 3.4vw, 4.4rem); }

body.sm-output-configured {
  background: var(--sm-output-bg, #000000);
}
body.sm-output-configured .sm-template {
  padding: var(--sm-output-padding-top, 4vh) var(--sm-output-padding-x, 6vw) var(--sm-output-padding-bottom, 4vh);
  align-items: var(--sm-output-align-items, center);
  justify-content: var(--sm-output-justify, center);
  text-align: var(--sm-output-text-align, center);
}
body.sm-output-configured .sm-content {
  max-width: var(--sm-output-max-width, 100%);
  max-height: var(--sm-output-max-height, 100%);
  font-size: calc(var(--sm-output-base-font-size, 4vw) * var(--sm-output-text-scale, 1));
  color: var(--sm-output-text-color, #ffffff);
  font-family: var(--sm-output-font-family, inherit);
  line-height: var(--sm-output-line-height, 1.18);
}
body.sm-output-configured .sm-footer,
body.sm-output-configured .sm-meta {
  max-width: var(--sm-output-max-width, 100%);
}
body.sm-output-configured .sm-meta {
  display: var(--sm-output-meta-display, block);
}
body.sm-output-configured .sm-footer {
  display: var(--sm-output-footer-display, block);
}
body.sm-output-configured .sm-content .chord {
  display: var(--sm-output-chord-display, none);
}
body.sm-output-configured .sm-content .section-label {
  display: var(--sm-output-section-display, none);
}
body.sm-output-configured .sm-content .lyric-split {
  display: var(--sm-output-split-display, none);
}
body.sm-output-configured .sm-lowerthird-panel {
  max-width: var(--sm-output-panel-max-width, 100%);
  max-height: var(--sm-output-panel-max-height, 100%);
  padding: var(--sm-output-panel-padding, 20px 28px);
  border-radius: var(--sm-output-panel-radius, 18px);
  background: var(--sm-output-panel-bg, rgba(6, 10, 16, 0.8));
  border: var(--sm-output-panel-border, 1px solid rgba(255, 255, 255, 0.3));
}
body.sm-output-configured.output-panel-off .sm-lowerthird-panel {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
body.sm-output-configured .sm-content .slide-image,
body.sm-output-configured .sm-content .slide-image.fit-actual,
body.sm-output-configured .sm-content .slide-image.fit-crop,
body.sm-output-configured .sm-content .slide-image.fit-stretch {
  height: var(--sm-output-image-max-height, 78vh);
  max-height: var(--sm-output-image-max-height, 78vh);
  padding: var(--sm-output-image-padding, 0);
}
body.sm-output-configured .sm-content .slide-image img {
  max-height: 100%;
}
body.sm-output-configured .sm-template,
body.sm-output-configured .sm-lowerthird-panel .sm-content,
body.sm-output-configured .sm-lowerthird-panel .sm-footer {
  transition-duration: var(--sm-output-fade-ms, 240ms);
}
body.sm-output-configured.mode-image .sm-template {
  padding: 0;
}
body.sm-output-configured.mode-image .sm-lowerthird-panel {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
body.sm-output-configured.mode-image .sm-footer {
  display: none;
}

#sm-clock-layer {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: none;
  pointer-events: none;
}
#sm-clock-layer.visible {
  display: block;
}
.sm-clock {
  position: absolute;
  font-size: var(--sm-clock-size, 8vw);
  font-family: var(--sm-clock-font, inherit);
  color: var(--sm-clock-color, #ffffff);
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  text-shadow: var(--sm-clock-shadow, none);
}
#sm-clock-layer[data-position="top-left"] .sm-clock { top: 4vh; left: 4vw; }
#sm-clock-layer[data-position="top-center"] .sm-clock { top: 4vh; left: 50%; transform: translateX(-50%); }
#sm-clock-layer[data-position="top-right"] .sm-clock { top: 4vh; right: 4vw; }
#sm-clock-layer[data-position="center-left"] .sm-clock { top: 50%; left: 4vw; transform: translateY(-50%); }
#sm-clock-layer[data-position="center"] .sm-clock { top: 50%; left: 50%; transform: translate(-50%, -50%); }
#sm-clock-layer[data-position="center-right"] .sm-clock { top: 50%; right: 4vw; transform: translateY(-50%); }
#sm-clock-layer[data-position="bottom-left"] .sm-clock { bottom: 4vh; left: 4vw; }
#sm-clock-layer[data-position="bottom-center"] .sm-clock { bottom: 4vh; left: 50%; transform: translateX(-50%); }
#sm-clock-layer[data-position="bottom-right"] .sm-clock { bottom: 4vh; right: 4vw; }
.sm-clock-analog {
  width: 1em;
  height: 1em;
  text-shadow: none;
  filter: var(--sm-clock-filter, none);
}
.sm-clock-face {
  position: absolute;
  inset: 0;
  border: 0.055em solid currentColor;
  border-radius: 50%;
}
.sm-clock-face::before {
  content: "";
  position: absolute;
  inset: 0.075em;
  border-radius: 50%;
  background: repeating-conic-gradient(from -0.5deg, currentColor 0 1.1deg, transparent 1.1deg 30deg);
  -webkit-mask: radial-gradient(circle, transparent 0 84%, #000 85%);
  mask: radial-gradient(circle, transparent 0 84%, #000 85%);
  opacity: 0.55;
}
.sm-clock-hand {
  position: absolute;
  left: 50%;
  bottom: 50%;
  transform-origin: 50% 100%;
  border-radius: 99px;
  background: currentColor;
}
.sm-clock-hour { width: 0.055em; height: 0.28em; margin-left: -0.0275em; }
.sm-clock-minute { width: 0.04em; height: 0.4em; margin-left: -0.02em; }
.sm-clock-second { width: 0.018em; height: 0.44em; margin-left: -0.009em; }
.sm-clock-analog:not(.with-seconds) .sm-clock-second { display: none; }
.sm-clock-center {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0.075em;
  height: 0.075em;
  margin: -0.0375em 0 0 -0.0375em;
  border-radius: 50%;
  background: currentColor;
}
`;

  function hexRgb(value, fallback) {
    const match = String(value || "").match(/^#([0-9a-f]{6})$/i);
    if (!match) return fallback;
    const number = Number.parseInt(match[1], 16);
    return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
  }

  function applyOutputConfig(state) {
    const config = state.displayConfig || {};
    const main = target === "main";
    const baseScale = main
      ? config.lowerThirdTextScale ?? config.textScale ?? 1
      : config.textScale ?? 1;
    const vars = document.documentElement.style;
    vars.setProperty("--sm-text-scale", String(baseScale));
    vars.setProperty("--sm-text-color", config.textColor || "#ffffff");
    vars.setProperty(
      "--sm-font-family",
      (main ? config.lowerThirdFontFamily || config.fontFamily : config.fontFamily) ||
        '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    );
    vars.setProperty(
      "--sm-lowerthird-image-max-height",
      `${config.lowerThirdImageMaxHeightPercent ?? 30}vh`,
    );
    const lowerThirdPadding = `${config.lowerThirdImagePadding ?? 48}px`;
    vars.setProperty("--sm-lowerthird-padding", lowerThirdPadding);
    vars.setProperty("--sm-lowerthird-image-padding", lowerThirdPadding);

    const output = state.outputs && state.outputs[outputId];
    if (!output) {
      document.body.classList.remove("sm-output-configured", "output-panel-off");
      for (const property of [
        "--sm-output-bg",
        "--sm-output-text-scale",
        "--sm-output-text-color",
        "--sm-output-font-family",
        "--sm-output-line-height",
        "--sm-output-padding-x",
        "--sm-output-padding-top",
        "--sm-output-padding-bottom",
        "--sm-output-align-items",
        "--sm-output-justify",
        "--sm-output-text-align",
        "--sm-output-max-width",
        "--sm-output-max-height",
        "--sm-output-panel-bg",
        "--sm-output-panel-padding",
        "--sm-output-panel-radius",
        "--sm-output-panel-border",
        "--sm-output-panel-max-width",
        "--sm-output-panel-max-height",
        "--sm-output-image-max-height",
        "--sm-output-image-padding",
        "--sm-output-meta-display",
        "--sm-output-footer-display",
        "--sm-output-chord-display",
        "--sm-output-section-display",
        "--sm-output-split-display",
        "--sm-output-fade-ms",
      ]) {
        vars.removeProperty(property);
      }
      fadeMs = 240;
      fadeMode = target === "main" ? "text" : "template";
      return;
    }

    const textScale = (output.text.scale ?? 1) * baseScale;
    const fontFamily =
      output.text.fontFamily ||
      (main ? config.lowerThirdFontFamily || config.fontFamily : config.fontFamily) ||
      '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif';
    const imageMaxHeight =
      output.image.maxHeightPercent ??
      (main ? config.lowerThirdImageMaxHeightPercent ?? 30 : 78);
    const imagePadding =
      output.image.padding ?? (main ? config.lowerThirdImagePadding ?? 48 : 0);
    const alignItems =
      output.layout.align === "left" ? "flex-start" : "center";
    const justifyContent =
      output.layout.verticalAlign === "start"
        ? "flex-start"
        : output.layout.verticalAlign === "end"
          ? "flex-end"
          : "center";

    document.body.classList.add("sm-output-configured");
    document.body.classList.toggle("output-panel-off", !output.panel.enabled);
    vars.setProperty(
      "--sm-output-bg",
      `rgba(${hexRgb(output.background, "0, 0, 0")}, ${output.backgroundAlpha})`,
    );
    vars.setProperty("--sm-output-text-scale", String(textScale));
    vars.setProperty("--sm-output-text-color", output.text.textColor || config.textColor || "#ffffff");
    vars.setProperty("--sm-output-font-family", fontFamily);
    vars.setProperty("--sm-output-line-height", String(output.text.lineHeight ?? 1.1));
    vars.setProperty("--sm-output-padding-x", `${output.layout.paddingX}vw`);
    vars.setProperty("--sm-output-padding-top", `${output.layout.paddingTop}vh`);
    vars.setProperty("--sm-output-padding-bottom", `${output.layout.paddingBottom}vh`);
    vars.setProperty("--sm-output-align-items", alignItems);
    vars.setProperty("--sm-output-justify", justifyContent);
    vars.setProperty("--sm-output-text-align", output.layout.textAlign);
    vars.setProperty("--sm-output-max-width", `${output.layout.maxWidthPercent}%`);
    vars.setProperty("--sm-output-max-height", `${output.layout.maxHeightPercent}%`);
    vars.setProperty(
      "--sm-output-panel-bg",
      `rgba(${hexRgb(output.panel.color, "6, 10, 16")}, ${output.panel.alpha})`,
    );
    vars.setProperty(
      "--sm-output-panel-padding",
      `${output.panel.paddingY}px ${output.panel.paddingX}px`,
    );
    vars.setProperty("--sm-output-panel-radius", `${output.panel.radius}px`);
    vars.setProperty(
      "--sm-output-panel-border",
      output.panel.border ? "1px solid rgba(255, 255, 255, 0.3)" : "0",
    );
    vars.setProperty("--sm-output-panel-max-width", `${output.panel.maxWidthPercent}%`);
    vars.setProperty("--sm-output-panel-max-height", `${output.panel.maxHeightPercent}%`);
    vars.setProperty("--sm-output-image-max-height", `${imageMaxHeight}vh`);
    vars.setProperty("--sm-output-image-padding", `${imagePadding}px`);
    vars.setProperty("--sm-output-meta-display", output.content.showMeta ? "block" : "none");
    vars.setProperty("--sm-output-footer-display", output.content.showFooter ? "block" : "none");
    vars.setProperty(
      "--sm-output-chord-display",
      output.content.showChords ? "inline-block" : "none",
    );
    vars.setProperty(
      "--sm-output-section-display",
      output.content.showSectionLabels ? "block" : "none",
    );
    vars.setProperty(
      "--sm-output-split-display",
      output.content.showSplitWords ? "inline" : "none",
    );
    vars.setProperty("--sm-output-fade-ms", `${output.fadeDurationMs}ms`);
    fadeMode = output.fade;
    fadeMs = Math.max(0, output.fadeDurationMs);
  }

  function clockMarkup(mode) {
    if (mode === "analog") {
      return '<div class="sm-clock sm-clock-analog" aria-label="Clock"><div class="sm-clock-face"><span class="sm-clock-hand sm-clock-hour"></span><span class="sm-clock-hand sm-clock-minute"></span><span class="sm-clock-hand sm-clock-second"></span><span class="sm-clock-center"></span></div></div>';
    }
    return '<div class="sm-clock sm-clock-digital"></div>';
  }

  function renderClock() {
    if (!clockSettings?.enabled) return;
    const now = new Date();
    if (clockSettings.mode === "analog") {
      const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
      const minutes = now.getMinutes() + seconds / 60;
      const hours = (now.getHours() % 12) + minutes / 60;
      const setHand = (selector, degrees) => {
        const hand = clockLayer.querySelector(selector);
        if (hand) hand.style.transform = `rotate(${degrees}deg)`;
      };
      setHand(".sm-clock-hour", hours * 30);
      setHand(".sm-clock-minute", minutes * 6);
      setHand(".sm-clock-second", seconds * 6);
      return;
    }
    const clock = clockLayer.querySelector(".sm-clock-digital");
    if (!clock) return;
    clock.textContent = now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: Boolean(clockSettings.hour12),
      ...(clockSettings.seconds ? { second: "2-digit" } : {}),
    });
  }

  function applyClock(state) {
    const output = state.outputs && state.outputs[outputId];
    const clock = output?.clock ?? null;
    clockSettings = clock;
    if (!clock?.enabled) {
      clockLayer.classList.remove("visible", "with-seconds");
      clockLayer.innerHTML = "";
      clockLayer.removeAttribute("data-position");
      clockMode = "";
      if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
      return;
    }
    const config = state.displayConfig || {};
    clockLayer.classList.add("visible");
    clockLayer.classList.toggle("with-seconds", clock.seconds);
    clockLayer.dataset.position = clock.position;
    clockLayer.style.setProperty("--sm-clock-size", `${clock.size}vw`);
    clockLayer.style.setProperty("--sm-clock-color", clock.color);
    clockLayer.style.setProperty(
      "--sm-clock-font",
      clock.fontFamily ||
        config.fontFamily ||
        '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    );
    clockLayer.style.setProperty(
      "--sm-clock-shadow",
      clock.shadow
        ? "0 0.06em 0.18em rgba(0, 0, 0, 0.8), 0 0 0.03em rgba(0, 0, 0, 0.9)"
        : "none",
    );
    clockLayer.style.setProperty(
      "--sm-clock-filter",
      clock.shadow ? "drop-shadow(0 0.04em 0.08em rgba(0, 0, 0, 0.8))" : "none",
    );
    if (clockMode !== clock.mode) {
      clockMode = clock.mode;
      clockLayer.innerHTML = clockMarkup(clock.mode);
    }
    renderClock();
    if (!clockTimer) clockTimer = setInterval(renderClock, 500);
  }

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
    const output = state.outputs && state.outputs[outputId];
    const showUpcoming = output
      ? output.content.pages === "upcoming"
      : target === "stage" || target === "chords";
    const livePages =
      showUpcoming
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

    applyOutputConfig(state);
    applyClock(state);

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
        style.textContent = `${template.css}\n${OUTPUT_CSS}`;
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
    if (root.innerHTML && fadeMode !== "none" && fadeMs > 0) {
      document.body.classList.add(fadeMode === "text" ? "sm-text-fading" : "sm-fading");
      if (fadeTimer) clearTimeout(fadeTimer);
      // Wait for the fade-out to finish before swapping the text.
      fadeTimer = setTimeout(commit, fadeMs);
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
