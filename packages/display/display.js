(() => {
  const target = document.body.dataset.target || "main";
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "dev-output";

  const stage = document.getElementById("stage");
  const content = document.getElementById("content");
  const footer = document.getElementById("footer");
  const meta = document.getElementById("meta");

  const socket = window.io({
    auth: { outputToken: token },
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
  });

  let lastPage = -1;

  function render(state) {
    if (!state) return;
    const page = state.pages && state.pages[state.pageIndex];
    const idle = !page || state.mode === "idle";

    document.body.classList.toggle("blank", Boolean(state.blank));
    document.body.classList.toggle("idle", idle);

    content.innerHTML = page ? page.html : "";
    footer.textContent = state.footer || "";

    if (target === "stage") {
      const parts = [];
      if (state.title) parts.push(state.title);
      if (page) parts.push(`${state.pageIndex + 1} / ${state.pageCount}`);
      if (state.transpose) parts.push(`transpose ${state.transpose > 0 ? "+" : ""}${state.transpose}`);
      meta.textContent = parts.join("  ·  ");
    }

    const pageIndex = page ? page.index : -1;
    if (pageIndex !== lastPage) {
      stage.classList.remove("fade");
      void stage.offsetWidth;
      stage.classList.add("fade");
      lastPage = pageIndex;
    }
  }

  socket.on("live:snapshot", render);
  socket.on("connect", () => document.body.classList.remove("offline"));
  socket.on("disconnect", () => document.body.classList.add("offline"));
  socket.on("connect_error", () => document.body.classList.add("offline"));

  // A quick local blank toggle for operators using a display page directly.
  window.addEventListener("keydown", (event) => {
    if (event.key === "b" || event.key === "B") {
      document.body.classList.toggle("blank");
    }
  });
})();
