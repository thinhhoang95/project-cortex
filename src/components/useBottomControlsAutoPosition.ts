"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

const BLOCKER_SELECTOR = "[data-bottom-controls-blocker]";
const TRANSITION_SETTLE_MS = 400;
const VIEWPORT_PADDING_PX = 16;

type BottomControlsBlockerSide = "left" | "right";

type PaneBounds = {
  side: BottomControlsBlockerSide;
  left: number;
  right: number;
};

type ComputeBottomControlsCenterOffsetArgs = {
  controlWidth: number;
  viewportWidth: number;
  viewportPadding?: number;
  panes: ReadonlyArray<PaneBounds>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getBlockerElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(BLOCKER_SELECTOR));
}

function isVisibleBlocker(element: HTMLElement, viewportWidth: number, viewportHeight: number): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  return rect.right > 0 && rect.left < viewportWidth && rect.bottom > 0 && rect.top < viewportHeight;
}

function getVisiblePaneBounds(): PaneBounds[] {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return getBlockerElements()
    .map((element) => {
      const side = element.dataset.bottomControlsBlocker;
      if (side !== "left" && side !== "right") {
        return null;
      }

      if (!isVisibleBlocker(element, viewportWidth, viewportHeight)) {
        return null;
      }

      const rect = element.getBoundingClientRect();

      return {
        side,
        left: rect.left,
        right: rect.right,
      } satisfies PaneBounds;
    })
    .filter((pane): pane is PaneBounds => pane !== null);
}

export function computeBottomControlsCenterOffset({
  controlWidth,
  viewportWidth,
  viewportPadding = VIEWPORT_PADDING_PX,
  panes,
}: ComputeBottomControlsCenterOffsetArgs): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return 0;
  }

  let leftBoundary = 0;
  let rightBoundary = viewportWidth;

  for (const pane of panes) {
    if (pane.side === "left") {
      leftBoundary = Math.max(leftBoundary, clamp(pane.right, 0, viewportWidth));
      continue;
    }

    rightBoundary = Math.min(rightBoundary, clamp(pane.left, 0, viewportWidth));
  }

  const targetCenter = (leftBoundary + rightBoundary) / 2;
  const safeControlWidth = Number.isFinite(controlWidth) && controlWidth > 0 ? controlWidth : 0;
  const minCenter = viewportPadding + safeControlWidth / 2;
  const maxCenter = viewportWidth - viewportPadding - safeControlWidth / 2;

  if (minCenter > maxCenter) {
    return 0;
  }

  return clamp(targetCenter, minCenter, maxCenter) - viewportWidth / 2;
}

export function getBottomControlsAnchorStyle(offsetX: number): CSSProperties {
  return {
    transform: `translateX(calc(-50% + ${offsetX}px))`,
  };
}

export function useBottomControlsAutoPosition(enabled = true) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setOffsetX(0);
      return;
    }

    let animationFrameId: number | null = null;
    let measureUntil = 0;

    const measure = () => {
      const controlWidth = anchorRef.current?.getBoundingClientRect().width ?? 0;
      const nextOffset = computeBottomControlsCenterOffset({
        controlWidth,
        viewportWidth: window.innerWidth,
        panes: getVisiblePaneBounds(),
      });

      setOffsetX((currentOffset) => (Math.abs(currentOffset - nextOffset) < 0.5 ? currentOffset : nextOffset));
    };

    const tick = (timestamp: number) => {
      measure();

      if (timestamp < measureUntil) {
        animationFrameId = window.requestAnimationFrame(tick);
        return;
      }

      animationFrameId = null;
    };

    const scheduleMeasure = (durationMs = TRANSITION_SETTLE_MS) => {
      measureUntil = Math.max(measureUntil, window.performance.now() + durationMs);

      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(tick);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      scheduleMeasure();
    });

    const blockerAttributeObserver = new MutationObserver(() => {
      scheduleMeasure();
    });

    const reconnectObservers = () => {
      resizeObserver.disconnect();
      blockerAttributeObserver.disconnect();

      if (anchorRef.current) {
        resizeObserver.observe(anchorRef.current);
      }

      for (const element of getBlockerElements()) {
        resizeObserver.observe(element);
        blockerAttributeObserver.observe(element, {
          attributes: true,
          attributeFilter: ["class", "style", "hidden", "aria-hidden", "data-bottom-controls-blocker"],
        });
      }
    };

    const blockerTreeObserver = new MutationObserver(() => {
      reconnectObservers();
      scheduleMeasure();
    });

    reconnectObservers();
    blockerTreeObserver.observe(document.body, { childList: true, subtree: true });

    measure();
    scheduleMeasure();

    const handleResize = () => {
      scheduleMeasure();
    };

    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      blockerTreeObserver.disconnect();
      blockerAttributeObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [enabled]);

  return {
    anchorRef,
    offsetX,
  };
}
