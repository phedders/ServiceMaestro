import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PreviewScreenPreset } from "../preview-screen";

const MAX_PREVIEW_HEIGHT = 280;

export function ScaledPreviewFrame({
  src,
  title,
  screen,
  children,
}: {
  src: string;
  title: string;
  screen: PreviewScreenPreset;
  children?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const availableWidth = container.clientWidth;
      if (!availableWidth) return;
      const aspect = screen.width / screen.height;
      let width = availableWidth;
      let height = width / aspect;
      if (height > MAX_PREVIEW_HEIGHT) {
        height = MAX_PREVIEW_HEIGHT;
        width = height * aspect;
      }
      setSize((current) =>
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [screen.width, screen.height]);

  const scale = size.width ? size.width / screen.width : 0;

  return (
    <div className="preview-frame" ref={containerRef}>
      <div className="preview-screen" style={{ width: size.width, height: size.height }}>
        <iframe
          src={src}
          title={title}
          loading="eager"
          style={{
            width: screen.width,
            height: screen.height,
            transform: `scale(${scale})`,
          }}
        />
        {children}
      </div>
    </div>
  );
}
