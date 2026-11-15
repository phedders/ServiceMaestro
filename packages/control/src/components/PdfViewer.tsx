import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export function PdfViewer({ assetId, title }: { assetId: string; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const taskRef = useRef<ReturnType<typeof pdfjs.getDocument> | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [zoomMode, setZoomMode] = useState<"width" | "height" | "actual" | "custom">("width");
  const [scale, setScale] = useState(1.15);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setPage(1);
    setPages(0);
    setPageSize(null);
    taskRef.current?.destroy();
    taskRef.current = null;
    pdfRef.current = null;

    fetch(`/api/assets/${assetId}/file`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load PDF (${response.status})`);
        const data = new Uint8Array(await response.arrayBuffer());
        const task = pdfjs.getDocument({ data });
        taskRef.current = task;
        const doc = await task.promise;
        if (cancelled) return;
        pdfRef.current = doc;
        setPages(doc.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      taskRef.current?.destroy();
      taskRef.current = null;
      pdfRef.current = null;
    };
  }, [assetId]);

  useEffect(() => {
    if (zoomMode === "custom") return;
    if (zoomMode === "actual") {
      setScale(1);
      return;
    }
    const wrap = wrapRef.current;
    if (!pageSize || !wrap) return;
    const fit = () => {
      const availableWidth = Math.max(120, wrap.clientWidth - 32);
      const availableHeight = Math.max(
        120,
        document.fullscreenElement ? window.innerHeight - 220 : window.innerHeight * 0.68 - 32,
      );
      const next =
        zoomMode === "height"
          ? availableHeight / pageSize.height
          : availableWidth / pageSize.width;
      setScale(Math.max(0.25, Math.min(3, next)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    window.addEventListener("resize", fit);
    document.addEventListener("fullscreenchange", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      document.removeEventListener("fullscreenchange", fit);
    };
  }, [pageSize, zoomMode]);

  useEffect(() => {
    const doc = pdfRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || !pages) return;
    let renderTask: pdfjs.RenderTask | null = null;

    doc.getPage(page).then((pdfPage) => {
      const base = pdfPage.getViewport({ scale: 1 });
      setPageSize((current) =>
        current && current.width === base.width && current.height === base.height
          ? current
          : { width: base.width, height: base.height },
      );
      const viewport = pdfPage.getViewport({ scale });
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport });
    });

    return () => {
      renderTask?.cancel();
    };
  }, [page, pages, scale]);

  function zoomBy(delta: number) {
    setZoomMode("custom");
    setScale((current) => Math.max(0.25, Math.min(3, current + delta)));
  }

  if (error) return <div className="pdf-error">{error}</div>;
  if (loading) return <div className="pdf-loading">Loading {title}…</div>;

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <div className="button-row">
          <button
            className="button ghost small"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            title="Show the previous PDF page"
            aria-label="Previous PDF page"
          >
            ←
          </button>
          <span>
            Page {page} / {pages}
          </span>
          <button
            className="button ghost small"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            title="Show the next PDF page"
            aria-label="Next PDF page"
          >
            →
          </button>
        </div>
        <div className="button-row pdf-zoom-controls">
          <label className="pdf-zoom-select">
            Zoom
            <select
              value={zoomMode}
              onChange={(event) =>
                setZoomMode(event.target.value as "width" | "height" | "actual" | "custom")
              }
              title="Choose how the PDF page fits the viewer"
            >
              <option value="width">Fit width</option>
              <option value="height">Fit height</option>
              <option value="actual">1:1</option>
              {zoomMode === "custom" && <option value="custom">Custom</option>}
            </select>
          </label>
          <button
            className="button ghost small"
            onClick={() => zoomBy(-0.15)}
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            className="button ghost small"
            onClick={() => zoomBy(0.15)}
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div className="pdf-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
