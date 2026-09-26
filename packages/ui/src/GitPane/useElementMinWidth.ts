import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * 元素宽度是否不小于 minWidthPx；首次布局前为 false。
 * 只保存布尔值：拖动调整面板宽度时，未跨过阈值的 resize 不会触发重新渲染。
 */
export function useElementMinWidth(
  ref: RefObject<HTMLElement | null>,
  minWidthPx: number,
): boolean {
  const [atLeast, setAtLeast] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    setAtLeast(element.getBoundingClientRect().width >= minWidthPx);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setAtLeast(entry.contentRect.width >= minWidthPx);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [minWidthPx, ref]);
  return atLeast;
}
