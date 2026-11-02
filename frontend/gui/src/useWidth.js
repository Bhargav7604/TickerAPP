import { useEffect, useState } from "react";

// Tracks an element's width so charts can draw in real pixels; falls back where ResizeObserver is missing (tests).
export default function useWidth(ref, fallback = 800) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
