import { useCallback, useEffect, useState, type RefObject } from "react";

const DEFAULT_ROW_HEIGHT = 58;
const DEFAULT_OVERSCAN = 10;

export function useVirtualTableWindow(
  rowCount: number,
  containerRef: RefObject<HTMLElement | null>,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
) {
  const [range, setRange] = useState(() => ({
    start: 0,
    end: Math.min(rowCount, 36),
  }));

  const update = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewport = el.clientHeight || 480;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(rowCount, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [containerRef, overscan, rowCount, rowHeight]);

  useEffect(() => {
    setRange({
      start: 0,
      end: Math.min(rowCount, 36),
    });
    update();
  }, [rowCount, update]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [containerRef, update]);

  return {
    startIndex: range.start,
    endIndex: range.end,
    topSpacerHeight: range.start * rowHeight,
    bottomSpacerHeight: Math.max(0, (rowCount - range.end) * rowHeight),
  };
}
